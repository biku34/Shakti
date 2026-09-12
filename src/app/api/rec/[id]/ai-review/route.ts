import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { reviewRecEvidence } from "@/services/fraud/groqDetector";
import { audit } from "@/services/audit";

// FR-7.8: on-demand Groq review of a single REC's backing evidence. Used by the
// issuance-queue evidence modal when a certificate isn't anchored yet (no hash
// to verify) — the AI scans the raw readings for anomalies to inform approval.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("certificate_body", "regulator", "auditor");
    const { id } = await ctx.params;
    const result = await reviewRecEvidence(id);
    await audit(session.userId, "rec.ai_review", { type: "rec", id }, {
      usedAI: result.usedAI,
      findings: result.findings.length,
    });
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
