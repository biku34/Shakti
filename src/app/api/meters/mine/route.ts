import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { MeterModel } from "@/models/Meter";
import { MeterReadingModel } from "@/models/MeterReading";

// Prosumer's meters + generation/export totals and currently-available surplus
// (export not yet committed to an offer or backing a REC). Powers the
// "My Meter / Generation" and "Sell Surplus" screens (§4.1).
export async function GET() {
  try {
    const session = await requireRole("prosumer");
    await connectDB();

    const meters = await MeterModel.find({ ownerId: session.userId });
    const meterIds = meters.map((m) => m._id);

    const totalsAgg = await MeterReadingModel.aggregate([
      { $match: { meterId: { $in: meterIds } } },
      {
        $group: {
          _id: null,
          generationKwh: { $sum: "$generationKwh" },
          consumptionKwh: { $sum: "$consumptionKwh" },
          exportKwh: { $sum: "$exportKwh" },
          committedExportKwh: { $sum: "$committedExportKwh" },
          recBackedKwh: { $sum: "$recBackedKwh" },
          verifiedExportKwh: {
            $sum: { $cond: [{ $eq: ["$verified", true] }, "$exportKwh", 0] },
          },
        },
      },
    ]);

    const t = totalsAgg[0] ?? {
      generationKwh: 0,
      consumptionKwh: 0,
      exportKwh: 0,
      committedExportKwh: 0,
      recBackedKwh: 0,
      verifiedExportKwh: 0,
    };
    const availableSurplusKwh = Math.max(
      0,
      t.verifiedExportKwh - t.committedExportKwh - t.recBackedKwh,
    );

    // Latest reading per meter for the "live" panel.
    const latest = await MeterReadingModel.aggregate([
      { $match: { meterId: { $in: meterIds } } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: "$meterId", reading: { $first: "$$ROOT" } } },
    ]);
    const latestByMeter = new Map(latest.map((l) => [String(l._id), l.reading]));

    return ok({
      meters: meters.map((m) => ({
        id: String(m._id),
        code: m.code,
        solarCapacityKw: m.solarCapacityKw,
        status: m.status,
        lastReadingAt: m.lastReadingAt,
        latest: latestByMeter.get(String(m._id)) ?? null,
      })),
      totals: {
        generationKwh: round(t.generationKwh),
        consumptionKwh: round(t.consumptionKwh),
        exportKwh: round(t.exportKwh),
        committedExportKwh: round(t.committedExportKwh),
        recBackedKwh: round(t.recBackedKwh),
        availableSurplusKwh: round(availableSurplusKwh),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function round(n: number): number {
  return Number((n ?? 0).toFixed(3));
}
