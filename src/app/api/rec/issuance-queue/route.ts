import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { RecCertificateModel } from "@/models/RecCertificate";

// FR-6.2: pending RECs awaiting certificate-body approval.
export async function GET() {
  try {
    await requireRole("certificate_body");
    await connectDB();
    const pending = await RecCertificateModel.find({ status: "pending" }).sort({ createdAt: 1 });
    return ok(pending);
  } catch (err) {
    return errorResponse(err);
  }
}
