/**
 * Groq-backed agentic fraud layer (§9.3, FR-7.8) — a COMPLEMENT to the
 * deterministic `RuleAnomalyDetector`, never a replacement. The rule engine
 * stays authoritative and runs on every ingest; this layer is invoked on demand
 * (the regulator's "AI review") to spot fuzzy / cross-entity patterns the rules
 * don't encode, and to triage. Its findings are advisory: they enter the same
 * alert pipeline (deduped) tagged with an `AI-…` ruleId and a plain-language
 * rationale, and still require a human to confirm before any action.
 */
import { isValidObjectId } from "mongoose";
import { env } from "@/lib/env";
import { MeterModel } from "@/models/Meter";
import { MeterReadingModel } from "@/models/MeterReading";
import { RecCertificateModel } from "@/models/RecCertificate";
import { TradeModel } from "@/models/Trade";
import { UserModel } from "@/models/User";
import { FeederModel } from "@/models/Feeder";
import { FraudAlertModel, FRAUD_TYPES } from "@/models/FraudAlert";
import { connectDB } from "@/lib/db";
import { type Finding, type IAnomalyDetector, raiseFindings } from "@/services/fraud/detector";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const SUBJECT_TYPES = ["rec", "meter", "prosumer", "trade"] as const;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export function isGroqConfigured(): boolean {
  return env.groqApiKeys().length > 0;
}

type ChatMessage = { role: "system" | "user"; content: string };

/** Call Groq's OpenAI-compatible chat API, rotating keys on rate-limit/auth errors. */
async function callGroq(messages: ChatMessage[]): Promise<string> {
  const keys = env.groqApiKeys();
  if (keys.length === 0) throw new Error("Groq is not configured");
  const model = env.groqModel();
  let lastErr: unknown;

  for (const key of keys) {
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0, // deterministic — same activity yields the same findings
          max_tokens: 1200,
          reasoning_effort: "low", // keep the token footprint small for free-tier TPM
          response_format: { type: "json_object" },
          messages,
        }),
      });
      // Exhausted / invalid key → try the next one in the pool.
      if (res.status === 429 || res.status === 401 || res.status === 403) {
        lastErr = new Error(`Groq key rejected (${res.status})`);
        continue;
      }
      if (!res.ok) throw new Error(`Groq error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All Groq keys failed");
}

type RawFinding = {
  type?: string;
  severity?: string;
  subjectType?: string;
  subjectId?: string;
  ruleId?: string;
  rationale?: string;
  confidence?: number;
  evidence?: Record<string, unknown>;
};

/**
 * Coerce the model's JSON into valid, non-hallucinated findings:
 * unknown ids are dropped, types/severities are constrained to the schema.
 */
function sanitize(raw: RawFinding[], knownIds: Set<string>): Finding[] {
  const out: Finding[] = [];
  for (const f of raw) {
    const subjectId = String(f.subjectId ?? "");
    if (!isValidObjectId(subjectId) || !knownIds.has(subjectId)) continue; // anti-hallucination
    const type = (FRAUD_TYPES as readonly string[]).includes(f.type ?? "") ? f.type! : "over_claim";
    const severity = (SEVERITIES as readonly string[]).includes(f.severity ?? "") ? f.severity! : "medium";
    const subjectType = (SUBJECT_TYPES as readonly string[]).includes(f.subjectType ?? "") ? f.subjectType! : "meter";
    out.push({
      type: type as Finding["type"],
      severity: severity as Finding["severity"],
      subjectType: subjectType as Finding["subjectType"],
      subjectId: subjectId as unknown as Finding["subjectId"],
      ruleId: `AI-${(f.ruleId ?? "GEN").replace(/^AI-/i, "").slice(0, 16)}`,
      evidence: {
        ai: true,
        rationale: (f.rationale ?? "").slice(0, 500),
        confidence: typeof f.confidence === "number" ? f.confidence : undefined,
        ...(f.evidence ?? {}),
      },
    });
  }
  return out.slice(0, 25);
}

function parseFindings(content: string, knownIds: Set<string>): Finding[] {
  let parsed: { findings?: RawFinding[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  return sanitize(Array.isArray(parsed.findings) ? parsed.findings : [], knownIds);
}

const SYSTEM_PROMPT = `You are a senior fraud analyst for Shakti, a peer-to-peer rooftop-solar energy marketplace with blockchain-anchored Renewable Energy Certificates (RECs) in Gandhinagar, India.

A deterministic rule engine already catches: generation above panel capacity, generation while offline, night-time generation, REC volume mismatch, duplicate/cross-feeder RECs, and issuance velocity. Do NOT just repeat those. Your job is to find SUBTLER, cross-entity or behavioural patterns a rule set misses — e.g. coordinated wash-trading between two parties, prices far outside the norm, a meter whose export pattern is physically implausible over time, or a cluster of accounts acting in concert.

Always specifically check for and report these high-value patterns when present:
1. Wash trading / collusion (subjectType "trade"): the same two parties trading back-and-forth on one feeder (reciprocal buyer↔seller), or circular energy movement.
2. Over-issued REC (subjectType "rec"): a certificate whose energyKwh materially exceeds the generation/export its meter plausibly produced in the data.
3. Physically implausible export (subjectType "meter"): exportKwh inconsistent with the meter's solarCapacityKw over time.

You are given recent platform activity as JSON. Return ONLY a JSON object of this exact shape:
{"findings":[{"type": one of ["duplicate_rec","over_claim","offline_generation","night_generation","volume_mismatch","velocity","cross_feeder"],"severity": one of ["low","medium","high","critical"],"subjectType": one of ["rec","meter","prosumer","trade"],"subjectId": an id copied EXACTLY from the input data,"ruleId": short slug like "wash-trade","rationale": one sentence a regulator can act on,"confidence": 0-1}]}

Rules:
- subjectId MUST be an id present in the input. Never invent ids.
- Pick the closest "type" from the allowed list; put your specific reasoning in "rationale".
- Only report genuine concerns. If nothing is suspicious, return {"findings":[]}. Quality over quantity (max ~8).`;

/** Compact snapshot of recent activity for the model, plus the set of valid ids. */
async function gatherContext(): Promise<{ payload: string; knownIds: Set<string> }> {
  const [readings, recs, trades, meters, users, feeders, openAlerts] = await Promise.all([
    MeterReadingModel.find().sort({ timestamp: -1 }).limit(16).lean(),
    RecCertificateModel.find().sort({ createdAt: -1 }).limit(10).lean(),
    TradeModel.find().sort({ createdAt: -1 }).limit(14).lean(),
    MeterModel.find().lean(),
    UserModel.find().select("name role").lean(),
    FeederModel.find().select("code").lean(),
    FraudAlertModel.find({ status: { $in: ["open", "investigating"] } }).select("ruleId subjectId").lean(),
  ]);

  const meterById = new Map(meters.map((m) => [String(m._id), m]));
  const userName = new Map(users.map((u) => [String(u._id), (u as { name?: string }).name ?? "?"]));
  const feederCode = new Map(feeders.map((f) => [String(f._id), (f as { code?: string }).code ?? "?"]));
  const knownIds = new Set<string>();

  const readingRows = readings.map((r) => {
    knownIds.add(String(r.meterId));
    const meter = meterById.get(String(r.meterId));
    return {
      meterId: String(r.meterId),
      meterCode: meter?.code ?? "?",
      solarCapacityKw: meter?.solarCapacityKw ?? null,
      at: new Date(r.timestamp).toISOString(),
      generationKwh: r.generationKwh,
      exportKwh: r.exportKwh,
      importKwh: r.importKwh,
      status: r.meterStatus,
      verified: r.verified,
    };
  });

  // Pre-computed per-meter generation from the readings window, so the model can
  // spot an over-issued REC without deep cross-referencing (cheap = TPM-friendly).
  const genByMeter = new Map<string, number>();
  for (const r of readings) {
    genByMeter.set(String(r.meterId), (genByMeter.get(String(r.meterId)) ?? 0) + (r.generationKwh ?? 0));
  }

  const recRows = recs.map((r) => {
    knownIds.add(String(r._id));
    const claimed = Number((r.energyMwh * 1000).toFixed(2));
    const meterGen = Number((genByMeter.get(String(r.meterId)) ?? 0).toFixed(2));
    return {
      recId: String(r._id),
      serial: r.serial,
      status: r.status,
      claimedKwh: claimed,
      meterRecentGenerationKwh: meterGen, // compare against claimedKwh
      overClaimRatio: meterGen > 0 ? Number((claimed / meterGen).toFixed(1)) : null,
      meterCode: meterById.get(String(r.meterId))?.code ?? "?",
      feeder: feederCode.get(String(r.feederId)) ?? "?",
    };
  });

  const tradeRows = trades.map((t) => {
    knownIds.add(String(t._id));
    return {
      tradeId: String(t._id),
      feeder: feederCode.get(String(t.feederId)) ?? "?",
      seller: userName.get(String(t.sellerId)) ?? "?",
      buyer: userName.get(String(t.buyerId)) ?? "?",
      quantityKwh: t.quantityKwh,
      pricePerKwh: t.pricePerKwh,
      status: t.status,
    };
  });

  // Pre-computed trade-pair reciprocity so wash trading is obvious to the model.
  const pairs = new Map<string, { parties: string; aToB: number; bToA: number; tradeIds: string[] }>();
  for (const t of trades) {
    const s = userName.get(String(t.sellerId)) ?? "?";
    const b = userName.get(String(t.buyerId)) ?? "?";
    const key = [s, b].sort().join(" ↔ ");
    const p = pairs.get(key) ?? { parties: key, aToB: 0, bToA: 0, tradeIds: [] };
    if (s <= b) p.aToB++; else p.bToA++;
    p.tradeIds.push(String(t._id));
    pairs.set(key, p);
  }
  const tradePatterns = [...pairs.values()]
    .filter((p) => p.aToB > 0 && p.bToA > 0) // reciprocal → possible wash trade
    .map((p) => ({ parties: p.parties, reciprocalTrades: p.aToB + p.bToA, tradeIds: p.tradeIds }));

  const payload = JSON.stringify({
    readings: readingRows,
    recs: recRows,
    trades: tradeRows,
    reciprocalTradePairs: tradePatterns,
    alreadyFlagged: openAlerts.map((a) => `${a.ruleId}:${String(a.subjectId)}`),
  });
  return { payload, knownIds };
}

export type AgenticReview = {
  usedAI: boolean;
  reason?: string;
  model?: string;
  reviewed?: { readings: number; recs: number; trades: number };
  findings: number;
  alertsRaised: number;
};

/** Run one holistic Groq review over recent activity and raise any findings. */
export async function runAgenticReview(): Promise<AgenticReview> {
  await connectDB();
  if (!isGroqConfigured()) {
    return { usedAI: false, reason: "Groq is not configured (set GROQ_API_KEYS)", findings: 0, alertsRaised: 0 };
  }

  const { payload, knownIds } = await gatherContext();
  let content: string;
  try {
    content = await callGroq([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Recent platform activity:\n${payload}` },
    ]);
  } catch (err) {
    // Rate limit / network / model error → degrade gracefully, never 500.
    const msg = err instanceof Error ? err.message : "AI review failed";
    const rateLimited = /429/.test(msg);
    return {
      usedAI: false,
      reason: rateLimited ? "AI review is rate-limited right now — try again in a minute" : `AI review unavailable: ${msg}`,
      findings: 0,
      alertsRaised: 0,
    };
  }
  const findings = parseFindings(content, knownIds);
  const alertsRaised = await raiseFindings(findings);

  const counts = JSON.parse(payload) as { readings: unknown[]; recs: unknown[]; trades: unknown[] };
  return {
    usedAI: true,
    model: env.groqModel(),
    reviewed: { readings: counts.readings.length, recs: counts.recs.length, trades: counts.trades.length },
    findings: findings.length,
    alertsRaised,
  };
}

/** Build the compact single-REC payload the model reviews (shared by scanRec + reviewRecEvidence). */
async function gatherRecContext(recId: string): Promise<{ payload: string; knownIds: Set<string> } | null> {
  const rec = await RecCertificateModel.findById(recId).lean();
  if (!rec) return null;
  const readings = await MeterReadingModel.find({ _id: { $in: rec.backingReadingIds } }).lean();
  const meter = await MeterModel.findById(rec.meterId).lean();

  const knownIds = new Set<string>([String(rec._id), String(rec.meterId)]);
  const payload = JSON.stringify({
    rec: {
      recId: String(rec._id),
      serial: rec.serial,
      energyKwh: Number((rec.energyMwh * 1000).toFixed(2)),
      meterId: String(rec.meterId),
      solarCapacityKw: meter?.solarCapacityKw ?? null,
    },
    backingReadings: readings.map((r) => ({
      at: new Date(r.timestamp).toISOString(),
      generationKwh: r.generationKwh,
      exportKwh: r.exportKwh,
      status: r.meterStatus,
      verified: r.verified,
    })),
  });
  return { payload, knownIds };
}

export type RecEvidenceReview = {
  usedAI: boolean;
  reason?: string;
  model?: string;
  findings: { type: string; severity: string; ruleId: string; rationale: string; confidence?: number }[];
};

/**
 * On-demand AI review of ONE certificate's backing evidence, for the issuance
 * queue. When a REC isn't anchored on-chain yet there is no hash to verify, so
 * the certificate body instead has Groq scan the raw backing readings for
 * anomalies before deciding to approve. Returns findings for display (it does
 * not raise pipeline alerts) and degrades gracefully when Groq is unavailable.
 */
export async function reviewRecEvidence(recId: string): Promise<RecEvidenceReview> {
  await connectDB();
  if (!isGroqConfigured()) {
    return { usedAI: false, reason: "AI review not configured (set GROQ_API_KEYS)", findings: [] };
  }
  const ctx = await gatherRecContext(recId);
  if (!ctx) return { usedAI: false, reason: "REC not found", findings: [] };

  let content: string;
  try {
    content = await callGroq([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Assess this single REC and its backing readings:\n${ctx.payload}` },
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI review failed";
    const rateLimited = /429/.test(msg);
    return {
      usedAI: false,
      reason: rateLimited ? "AI review is rate-limited — try again in a minute" : `AI review unavailable: ${msg}`,
      findings: [],
    };
  }
  const findings = parseFindings(content, ctx.knownIds).map((f) => ({
    type: String(f.type),
    severity: String(f.severity),
    ruleId: f.ruleId,
    rationale: String((f.evidence as { rationale?: string }).rationale ?? ""),
    confidence: (f.evidence as { confidence?: number }).confidence,
  }));
  return { usedAI: true, model: env.groqModel(), findings };
}

/**
 * Swappable agentic detector (FR-7.8). `scanRec` runs a Groq review of a single
 * certificate; `scanReading` is intentionally a no-op — per-reading LLM calls
 * are left to the deterministic rules (cost/latency), and the batch review above
 * covers reading-level patterns holistically.
 */
export class GroqAgenticDetector implements IAnomalyDetector {
  async scanReading(): Promise<Finding[]> {
    return [];
  }

  async scanRec(recId: string): Promise<Finding[]> {
    await connectDB();
    if (!isGroqConfigured()) return [];
    const ctx = await gatherRecContext(recId);
    if (!ctx) return [];
    try {
      const content = await callGroq([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Assess this single REC and its backing readings:\n${ctx.payload}` },
      ]);
      return parseFindings(content, ctx.knownIds);
    } catch {
      return [];
    }
  }
}
