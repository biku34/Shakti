import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { runAgenticReview } from "@/services/fraud/groqDetector";
import { audit } from "@/services/audit";

// FR-7.8: Groq agentic review — a complementary AI pass over recent activity
// that raises advisory alerts (AI-… ruleId) into the same pipeline.
export async function POST() {
  try {
    const session = await requireRole("regulator");
    const result = await runAgenticReview();
    await audit(session.userId, "fraud.ai_scan", undefined, result as unknown as Record<string, unknown>);
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
