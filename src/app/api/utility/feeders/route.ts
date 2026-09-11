import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { FeederModel } from "@/models/Feeder";
import { MeterModel } from "@/models/Meter";
import { MeterReadingModel } from "@/models/MeterReading";
import { classifyCongestion } from "@/lib/congestion";

// FR-9.1: per-feeder load, congestion, capacity and connected-meter count.
// Solar output is computed live from the latest reading per meter — this always
// reflects current meter readings, and falls back to the most recent recorded
// reading for any meter that is not reporting right now.
export async function GET() {
  try {
    await requireRole("utility", "regulator");
    await connectDB();
    const feeders = await FeederModel.find().sort({ code: 1 }).lean();

    // Count connected meters per feeder in one grouped query.
    const counts = await MeterModel.aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: "$feederId", count: { $sum: 1 } } },
    ]);
    const countByFeeder = new Map(counts.map((c) => [String(c._id), c.count]));

    // Solar output (kW) per feeder = Σ over meters of the latest reading's
    // generation, converted from kWh to kW using the reading interval.
    const loads = await MeterReadingModel.aggregate<{ _id: unknown; loadKw: number }>([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$meterId",
          feederId: { $first: "$feederId" },
          generationKwh: { $first: "$generationKwh" },
          intervalMinutes: { $first: "$intervalMinutes" },
        },
      },
      {
        $group: {
          _id: "$feederId",
          loadKw: {
            $sum: {
              $divide: [
                "$generationKwh",
                { $divide: [{ $ifNull: ["$intervalMinutes", 15] }, 60] },
              ],
            },
          },
        },
      },
    ]);
    const loadByFeeder = new Map(loads.map((l) => [String(l._id), l.loadKw]));

    const enriched = feeders.map((f) => {
      const loadKw = Number((loadByFeeder.get(String(f._id)) ?? 0).toFixed(2));
      return {
        ...f,
        currentLoadKw: loadKw,
        congestionLevel: classifyCongestion(loadKw, f.capacityKw),
        meterCount: countByFeeder.get(String(f._id)) ?? 0,
      };
    });
    return ok(enriched);
  } catch (err) {
    return errorResponse(err);
  }
}
