import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { RecCertificateModel } from "@/models/RecCertificate";

// REC registry — full list for the certificate body, regulator and auditor
// (REC Registry / Provenance Explorer screens). Optional ?status= filter.
export async function GET(req: Request) {
  try {
    await requireRole("certificate_body", "regulator", "auditor");
    await connectDB();
    const status = new URL(req.url).searchParams.get("status");
    const filter = status ? { status } : {};
    const recs = await RecCertificateModel.find(filter).sort({ createdAt: -1 }).limit(500);
    return ok(recs);
  } catch (err) {
    return errorResponse(err);
  }
}
