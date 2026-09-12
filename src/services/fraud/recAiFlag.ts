/**
 * Per-REC AI anomaly flagging. Runs the Groq per-REC evidence review over a
 * certificate and stores a compact verdict (`aiReview`) on the REC document, so
 * the REC registry can show a flag inline. Called (fire-and-forget) on every
 * state change — issue, list, transfer/sale — and by the registry sweep.
 */
import { connectDB } from "@/lib/db";
import { RecCertificateModel } from "@/models/RecCertificate";
import { reviewRecEvidence } from "@/services/fraud/groqDetector";

const RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export type RecAiState = "unchecked" | "clean" | "flagged" | "error";

/** Review one REC's evidence with the LLM and persist the verdict. Never throws. */
export async function reviewAndFlagRec(recId: string): Promise<RecAiState> {
  try {
    const review = await reviewRecEvidence(recId);
    let update: {
      state: RecAiState; severity: string | null; reason: string | null; model: string | null; checkedAt: Date;
    };

    if (!review.usedAI) {
      update = { state: "error", severity: null, reason: review.reason ?? "AI unavailable", model: null, checkedAt: new Date() };
    } else if (review.findings.length > 0) {
      const worst = review.findings.reduce((a, b) => ((RANK[b.severity] ?? 0) > (RANK[a.severity] ?? 0) ? b : a));
      update = {
        state: "flagged",
        severity: worst.severity,
        reason: worst.rationale || `${review.findings.length} anomaly finding(s)`,
        model: review.model ?? null,
        checkedAt: new Date(),
      };
    } else {
      update = { state: "clean", severity: null, reason: null, model: review.model ?? null, checkedAt: new Date() };
    }

    await connectDB();
    // Read back the persisted value so the returned state reflects what actually
    // saved (guards against a stale/strict schema silently dropping the write).
    const saved = await RecCertificateModel.findByIdAndUpdate(
      recId,
      { $set: { aiReview: update } },
      { new: true },
    ).select("aiReview").lean();
    return ((saved as { aiReview?: { state?: RecAiState } } | null)?.aiReview?.state) ?? "error";
  } catch (err) {
    console.error("[recAiFlag] review failed:", recId, err);
    return "error";
  }
}

/**
 * Sweep the registry: review RECs that haven't been checked yet (or all of them
 * with `all`), capped and sequential to stay within LLM rate limits. Returns how
 * many were scanned and how many came back flagged.
 */
export async function reviewRegistry(opts?: { all?: boolean; limit?: number }): Promise<{ scanned: number; flagged: number }> {
  await connectDB();
  const limit = Math.min(opts?.limit ?? 12, 40);
  const liveStatuses = { status: { $in: ["pending", "issued", "transferred"] } };
  const filter = opts?.all
    ? liveStatuses
    : { ...liveStatuses, $or: [{ "aiReview.state": { $exists: false } }, { "aiReview.state": "unchecked" }] };

  const recs = await RecCertificateModel.find(filter).sort({ createdAt: -1 }).limit(limit).select("_id").lean();
  let flagged = 0;
  for (const r of recs) {
    const state = await reviewAndFlagRec(String(r._id));
    if (state === "flagged") flagged++;
  }
  return { scanned: recs.length, flagged };
}
