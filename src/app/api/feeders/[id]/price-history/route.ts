import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { PricingSnapshotModel } from "@/models/PricingSnapshot";

// Rolling window for the High/Low readout — the highest and lowest clearing
// price over the trailing 60 minutes (independent of how many chart points are
// requested; a snapshot is written every orderbook poll, so 60 points is only
// a couple of minutes).
const HILO_WINDOW_MINUTES = 60;

// Recent clearing-price snapshots for a feeder — the "market price" chart.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole();
    await connectDB();
    const { id: feederId } = await ctx.params;
    const limit = Math.min(Number(new URL(req.url).searchParams.get("points") ?? 60), 200);

    const since = new Date(Date.now() - HILO_WINDOW_MINUTES * 60 * 1000);

    const [rows, range] = await Promise.all([
      PricingSnapshotModel.find({ feederId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .select("timestamp clearingPrice supplyKwh demandKwh fitFloor retailCeiling"),
      // High/Low over the trailing 60 min — an indexed min/max, so we don't pull
      // an hour of documents just to reduce them on the client.
      PricingSnapshotModel.aggregate<{ high: number; low: number }>([
        {
          $match: {
            feederId: Types.ObjectId.isValid(feederId) ? new Types.ObjectId(feederId) : feederId,
            timestamp: { $gte: since },
          },
        },
        { $group: { _id: null, high: { $max: "$clearingPrice" }, low: { $min: "$clearingPrice" } } },
      ]),
    ]);

    const points = rows.reverse().map((r) => ({
      t: r.timestamp,
      price: r.clearingPrice,
      supplyKwh: r.supplyKwh,
      demandKwh: r.demandKwh,
      fitFloor: r.fitFloor,
      retailCeiling: r.retailCeiling,
    }));

    return ok({
      points,
      high: range[0]?.high ?? null,
      low: range[0]?.low ?? null,
      windowMinutes: HILO_WINDOW_MINUTES,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
