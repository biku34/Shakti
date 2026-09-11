import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { FraudAlertModel } from "@/models/FraudAlert";

// FR-10.1: list fraud alerts (optionally filter by ?status= / ?severity=).
export async function GET(req: Request) {
  try {
    await requireRole("regulator", "certificate_body");
    await connectDB();
    const url = new URL(req.url);
    const filter: Record<string, unknown> = {};
    const status = url.searchParams.get("status");
    const severity = url.searchParams.get("severity");
    if (status) filter.status = status;
    if (severity) filter.severity = severity;

    const alerts = await FraudAlertModel.find(filter).sort({ createdAt: -1 }).limit(500);
    return ok(alerts);
  } catch (err) {
    return errorResponse(err);
  }
}
