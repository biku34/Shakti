import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { RecCertificateModel } from "@/models/RecCertificate";

// RECs the caller generated or currently holds ("My RECs" screen).
export async function GET() {
  try {
    const session = await requireRole("prosumer", "consumer", "certificate_body");
    await connectDB();
    const recs = await RecCertificateModel.find({
      $or: [{ generatorId: session.userId }, { currentHolderId: session.userId }],
    }).sort({ createdAt: -1 });
    return ok(recs);
  } catch (err) {
    return errorResponse(err);
  }
}
