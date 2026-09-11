import { connectDB } from "@/lib/db";
import { ok, fail, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { RecCertificateModel } from "@/models/RecCertificate";
import { RecTransactionModel } from "@/models/RecTransaction";
import { MeterReadingModel } from "@/models/MeterReading";
import { verifyRecord } from "@/services/blockchain/adapter";

// FR-10.2: full REC lineage (readings → issuance → transfers → retirement) + on-chain check.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("auditor", "regulator", "certificate_body");
    await connectDB();
    const { id } = await ctx.params;

    const rec = await RecCertificateModel.findById(id);
    if (!rec) return fail(404, "REC not found");

    const [readings, transactions] = await Promise.all([
      MeterReadingModel.find({ _id: { $in: rec.backingReadingIds } }).sort({ timestamp: 1 }),
      RecTransactionModel.find({ recId: rec._id }).sort({ timestamp: 1 }),
    ]);

    // FR-8.4: re-hash the issued record and confirm it matches the anchor.
    const verification = await verifyRecord("rec", id, {
      serial: rec.serial,
      generatorId: String(rec.generatorId),
      meterId: String(rec.meterId),
      energyMwh: rec.energyMwh,
      generationWindow: rec.generationWindow,
      backingReadingIds: rec.backingReadingIds.map(String),
    });

    return ok({ certificate: rec, backingReadings: readings, transactions, verification });
  } catch (err) {
    return errorResponse(err);
  }
}
