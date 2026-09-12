/**
 * UEBA (User & Entity Behaviour Analytics) surveillance — a Gemini-backed pass
 * that profiles each entity's trading + REC behaviour and flags fake-trading
 * patterns the deterministic rules don't encode: wash trading between two
 * parties, circular REC flipping, abnormal buy/sell velocity, collusion.
 *
 * It is advisory: findings are returned for the REC authority to review (they do
 * not auto-raise pipeline alerts). Degrades gracefully when Gemini is unavailable.
 */
import { connectDB } from "@/lib/db";
import { env } from "@/lib/env";
import { UserModel } from "@/models/User";
import { TradeModel } from "@/models/Trade";
import { RecTransactionModel } from "@/models/RecTransaction";
import { RecCertificateModel } from "@/models/RecCertificate";
import { geminiJson, isGeminiConfigured } from "@/services/ai/gemini";

const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export type UebaFlag = { entityName: string; riskLevel: string; behavior: string; rationale: string };
export type UebaResult = { usedAI: boolean; reason?: string; model?: string; entitiesProfiled?: number; flags: UebaFlag[] };

type Metric = {
  name: string;
  role: string;
  energySoldKwh: number;
  energyBoughtKwh: number;
  sellTrades: number;
  buyTrades: number;
  recsGenerated: number;
  recsSold: number;
  recsBought: number;
  creditBalance: number;
};

const SYSTEM_PROMPT = `You are a UEBA (User & Entity Behaviour Analytics) analyst for Shakti, a peer-to-peer rooftop-solar energy + REC marketplace in Gandhinagar, India, where credits are the only currency.

You are given per-entity behaviour metrics and reciprocal trade pairs. Flag entities whose behaviour indicates fake or manipulative trading, NOT normal activity. Look specifically for:
- Wash trading / collusion: two parties trading energy or RECs back-and-forth (reciprocal buyer↔seller) to fake volume or launder credits.
- Circular REC flipping: an entity that buys and re-sells RECs rapidly with little real holding.
- Abnormal velocity: buy/sell counts far above peers.
- Self-dealing rings: a small cluster moving the same value in a loop.

Return ONLY a JSON object of this exact shape:
{"flags":[{"entityName": a name copied EXACTLY from the input,"riskLevel": one of ["low","medium","high","critical"],"behavior": a short label like "wash-trading" or "rec-flipping","rationale": one sentence citing the numbers}]}

Rules:
- entityName MUST be a name present in the input. Never invent names.
- Only flag genuine concerns. If nothing is suspicious, return {"flags":[]}. Quality over quantity (max 8).`;

async function gatherContext(): Promise<{ payload: string; knownNames: Set<string>; entitiesProfiled: number }> {
  const [users, trades, recTxns, recs] = await Promise.all([
    UserModel.find({ role: { $in: ["prosumer", "consumer"] } }).select("name role creditBalance").lean(),
    TradeModel.find({ status: "settled" }).sort({ createdAt: -1 }).limit(400).lean(),
    RecTransactionModel.find({ action: "transfer" }).sort({ timestamp: -1 }).limit(400).lean(),
    RecCertificateModel.find().select("generatorId").lean(),
  ]);

  const nameById = new Map(users.map((u) => [String(u._id), (u as { name?: string }).name ?? "?"]));
  const metric = new Map<string, Metric>();
  for (const u of users) {
    metric.set(String(u._id), {
      name: (u as { name?: string }).name ?? "?",
      role: (u as { role?: string }).role ?? "?",
      energySoldKwh: 0, energyBoughtKwh: 0, sellTrades: 0, buyTrades: 0,
      recsGenerated: 0, recsSold: 0, recsBought: 0,
      creditBalance: Number(((u as { creditBalance?: number }).creditBalance ?? 0).toFixed(2)),
    });
  }

  // Energy trades → per-entity buy/sell metrics + directional pair counts.
  const pairDir = new Map<string, number>(); // key "A>B" = count of A selling to B
  for (const t of trades) {
    const s = metric.get(String(t.sellerId));
    const b = metric.get(String(t.buyerId));
    const qty = t.quantityKwh ?? 0;
    if (s) { s.energySoldKwh += qty; s.sellTrades++; }
    if (b) { b.energyBoughtKwh += qty; b.buyTrades++; }
    const sn = nameById.get(String(t.sellerId));
    const bn = nameById.get(String(t.buyerId));
    if (sn && bn) pairDir.set(`${sn}>${bn}`, (pairDir.get(`${sn}>${bn}`) ?? 0) + 1);
  }

  // REC transfers (priced sales) → per-entity REC buy/sell metrics.
  for (const tx of recTxns) {
    const from = tx.fromId ? metric.get(String(tx.fromId)) : undefined;
    const to = tx.toId ? metric.get(String(tx.toId)) : undefined;
    if (from) from.recsSold++;
    if (to) to.recsBought++;
  }
  for (const r of recs) {
    const g = metric.get(String(r.generatorId));
    if (g) g.recsGenerated++;
  }

  // Keep only entities with any activity, ranked by total activity.
  const rows = [...metric.values()]
    .map((m) => ({ ...m, activity: m.sellTrades + m.buyTrades + m.recsSold + m.recsBought + m.recsGenerated }))
    .filter((m) => m.activity > 0)
    .sort((a, b) => b.activity - a.activity)
    .slice(0, 30);

  // Reciprocal trade pairs (A↔B both directions) — the wash-trade signal.
  const reciprocal: { parties: string; aToB: number; bToA: number }[] = [];
  const seen = new Set<string>();
  for (const [key, count] of pairDir) {
    const [a, b] = key.split(">");
    const revKey = `${b}>${a}`;
    const pairKey = [a, b].sort().join("↔");
    if (seen.has(pairKey)) continue;
    const rev = pairDir.get(revKey);
    if (rev) { reciprocal.push({ parties: `${a} ↔ ${b}`, aToB: count, bToA: rev }); seen.add(pairKey); }
  }

  const knownNames = new Set(rows.map((r) => r.name));
  const payload = JSON.stringify({
    entities: rows.map(({ activity, ...m }) => ({ ...m, energySoldKwh: Number(m.energySoldKwh.toFixed(1)), energyBoughtKwh: Number(m.energyBoughtKwh.toFixed(1)), _activity: activity })),
    reciprocalTradePairs: reciprocal,
  });
  return { payload, knownNames, entitiesProfiled: rows.length };
}

type RawFlag = { entityName?: string; riskLevel?: string; behavior?: string; rationale?: string };

function sanitize(raw: RawFlag[], known: Set<string>): UebaFlag[] {
  const out: UebaFlag[] = [];
  for (const f of raw) {
    const entityName = String(f.entityName ?? "");
    if (!known.has(entityName)) continue; // anti-hallucination
    const riskLevel = (RISK_LEVELS as readonly string[]).includes(f.riskLevel ?? "") ? f.riskLevel! : "medium";
    out.push({
      entityName,
      riskLevel,
      behavior: String(f.behavior ?? "anomaly").slice(0, 40),
      rationale: String(f.rationale ?? "").slice(0, 240),
    });
  }
  return out.slice(0, 8);
}

/** Run one Gemini UEBA pass over recent behaviour and return entity flags. */
export async function runUebaAnalysis(): Promise<UebaResult> {
  await connectDB();
  if (!isGeminiConfigured()) {
    return { usedAI: false, reason: "Gemini not configured (set GEMINI_API_KEYS)", flags: [] };
  }
  const { payload, knownNames, entitiesProfiled } = await gatherContext();
  if (entitiesProfiled === 0) {
    return { usedAI: true, model: env.geminiModel(), entitiesProfiled: 0, flags: [] };
  }

  let text: string;
  try {
    text = await geminiJson(SYSTEM_PROMPT, `Entity behaviour:\n${payload}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UEBA unavailable";
    return { usedAI: false, reason: /429/.test(msg) ? "Gemini rate-limited — try again shortly" : msg, flags: [] };
  }

  let parsed: { flags?: RawFlag[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { usedAI: false, reason: "Gemini returned invalid JSON", flags: [] };
  }
  const flags = sanitize(Array.isArray(parsed.flags) ? parsed.flags : [], knownNames);
  return { usedAI: true, model: env.geminiModel(), entitiesProfiled, flags };
}
