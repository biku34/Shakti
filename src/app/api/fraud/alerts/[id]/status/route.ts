import { z } from "zod";
import { connectDB } from "@/lib/db";
import { ok, fail, parseBody, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { FraudAlertModel } from "@/models/FraudAlert";
import { audit } from "@/services/audit";

const schema = z.object({
  status: z.enum(["open", "investigating", "confirmed", "dismissed"]),
});

// FR-7.6: triage an alert (open → investigating → confirmed|dismissed).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("regulator", "certificate_body");
    await connectDB();
    const { id } = await ctx.params;
    const { status } = await parseBody(req, schema);

    const alert = await FraudAlertModel.findById(id);
    if (!alert) return fail(404, "Alert not found");
    alert.status = status;
    alert.resolvedBy = ["confirmed", "dismissed"].includes(status) ? (session.userId as never) : null;
    await alert.save();

    await audit(session.userId, "fraud.triage", { type: "fraud_alert", id }, { status });
    return ok(alert);
  } catch (err) {
    return errorResponse(err);
  }
}
