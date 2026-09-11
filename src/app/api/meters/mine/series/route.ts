import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { MeterModel } from "@/models/Meter";
import { MeterReadingModel } from "@/models/MeterReading";

// Time-series of the prosumer's aggregated energy flow, newest N intervals.
// Powers the live "stock-ticker" charts on the prosumer Home screen.
export async function GET(req: Request) {
  try {
    const session = await requireRole("prosumer");
    await connectDB();
    const limit = Math.min(Number(new URL(req.url).searchParams.get("points") ?? 48), 200);

    const meters = await MeterModel.find({ ownerId: session.userId }).select("_id");
    const meterIds = meters.map((m) => m._id);

    const rows = await MeterReadingModel.aggregate([
      { $match: { meterId: { $in: meterIds } } },
      {
        $group: {
          _id: "$timestamp",
          generationKwh: { $sum: "$generationKwh" },
          consumptionKwh: { $sum: "$consumptionKwh" },
          exportKwh: { $sum: "$exportKwh" },
          importKwh: { $sum: "$importKwh" },
          intervalMinutes: { $max: "$intervalMinutes" },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: limit },
    ]);

    // Oldest → newest for left-to-right plotting; convert energy → power (kW).
    const points = rows
      .reverse()
      .map((r) => {
        const hrs = (r.intervalMinutes ?? 15) / 60;
        return {
          t: r._id,
          generationKw: Number((r.generationKwh / hrs).toFixed(3)),
          consumptionKw: Number((r.consumptionKwh / hrs).toFixed(3)),
          exportKw: Number((r.exportKwh / hrs).toFixed(3)),
          importKw: Number((r.importKwh / hrs).toFixed(3)),
        };
      });

    return ok({ points });
  } catch (err) {
    return errorResponse(err);
  }
}
