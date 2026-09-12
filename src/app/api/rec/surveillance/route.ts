import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { runAgenticReview, type AgenticReview } from "@/services/fraud/groqDetector";
import { runUebaAnalysis, type UebaResult } from "@/services/fraud/ueba";
import { audit } from "@/services/audit";

// REC authority AI fraud surveillance: runs BOTH LLM layers in parallel —
// Groq over evidence + transfers + trades (wash-trading, over-issued RECs), and
// Gemini UEBA over per-entity behaviour. One failing layer never blocks the
// other. Groq findings enter the alert pipeline; UEBA flags are advisory.
export async function POST() {
  try {
    const session = await requireRole("certificate_body", "regulator");

    const [groqRes, uebaRes] = await Promise.allSettled([runAgenticReview(), runUebaAnalysis()]);

    const groq: AgenticReview =
      groqRes.status === "fulfilled"
        ? groqRes.value
        : { usedAI: false, reason: "Groq review failed", findings: 0, alertsRaised: 0 };
    const ueba: UebaResult =
      uebaRes.status === "fulfilled"
        ? uebaRes.value
        : { usedAI: false, reason: "UEBA analysis failed", flags: [] };

    await audit(session.userId, "rec.surveillance", undefined, {
      groqAlertsRaised: groq.alertsRaised,
      uebaFlags: ueba.flags.length,
    });
    return ok({ groq, ueba });
  } catch (err) {
    return errorResponse(err);
  }
}
