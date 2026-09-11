import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { MeterReadingModel } from "@/models/MeterReading";
import { RecCertificateModel } from "@/models/RecCertificate";
import { detectOnReading, detectOnRec } from "@/services/fraud/detector";
import { audit } from "@/services/audit";

// FR-7: trigger a full rule scan across recent readings and all live RECs.
export async function POST() {
  try {
    const session = await requireRole("regulator");
    await connectDB();

    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const readings = await MeterReadingModel.find({ timestamp: { $gte: dayAgo } }).select("_id");
    const recs = await RecCertificateModel.find({ status: { $ne: "revoked" } }).select("_id");

    let alertsRaised = 0;
    for (const r of readings) alertsRaised += await detectOnReading(String(r._id));
    for (const c of recs) alertsRaised += await detectOnRec(String(c._id));

    await audit(session.userId, "fraud.scan", undefined, {
      readingsScanned: readings.length,
      recsScanned: recs.length,
      alertsRaised,
    });
    return ok({ readingsScanned: readings.length, recsScanned: recs.length, alertsRaised });
  } catch (err) {
    return errorResponse(err);
  }
}
