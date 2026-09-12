import { connectDB } from "@/lib/db";
import { ok, fail, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { RecCertificateModel } from "@/models/RecCertificate";
import { RecTransactionModel } from "@/models/RecTransaction";
import { MeterReadingModel } from "@/models/MeterReading";
import { UserModel } from "@/models/User";
import { MeterModel } from "@/models/Meter";
import { FeederModel } from "@/models/Feeder";
import { verifyRecord } from "@/services/blockchain/adapter";

// FR-10.2: full REC lineage (readings → issuance → transfers → retirement) + on-chain check.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("auditor", "regulator", "certificate_body");
    await connectDB();
    const { id } = await ctx.params;

    const rec = await RecCertificateModel.findById(id);
    if (!rec) return fail(404, "REC not found");

    const [readings, transactions, generator, holder, meter, feeder] = await Promise.all([
      MeterReadingModel.find({ _id: { $in: rec.backingReadingIds } }).sort({ timestamp: 1 }),
      RecTransactionModel.find({ recId: rec._id }).sort({ timestamp: 1 }),
      UserModel.findById(rec.generatorId).select("name email").lean(),
      UserModel.findById(rec.currentHolderId).select("name email role").lean(),
      MeterModel.findById(rec.meterId).select("code solarCapacityKw").lean(),
      FeederModel.findById(rec.feederId).select("name code").lean(),
    ]);

    // Human-readable parties so the auditor detail view shows the full record,
    // not just ObjectIds.
    const parties = {
      generator: generator ? { name: generator.name, email: generator.email } : null,
      currentHolder: holder ? { name: holder.name, email: holder.email, role: holder.role } : null,
      meter: meter ? { code: meter.code, solarCapacityKw: meter.solarCapacityKw } : null,
      feeder: feeder ? { name: feeder.name, code: feeder.code } : null,
    };

    // FR-8.4: re-hash the issued record and confirm it matches the anchor.
    const verification = await verifyRecord("rec", id, {
      serial: rec.serial,
      generatorId: String(rec.generatorId),
      meterId: String(rec.meterId),
      energyMwh: rec.energyMwh,
      generationWindow: rec.generationWindow,
      backingReadingIds: rec.backingReadingIds.map(String),
    });

    return ok({ certificate: rec, parties, backingReadings: readings, transactions, verification });
  } catch (err) {
    return errorResponse(err);
  }
}
