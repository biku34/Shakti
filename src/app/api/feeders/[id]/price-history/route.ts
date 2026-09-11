import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { PricingSnapshotModel } from "@/models/PricingSnapshot";

// Recent clearing-price snapshots for a feeder — the "market price" chart.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole();
    await connectDB();
    const { id: feederId } = await ctx.params;
    const limit = Math.min(Number(new URL(req.url).searchParams.get("points") ?? 60), 200);

    const rows = await PricingSnapshotModel.find({ feederId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .select("timestamp clearingPrice supplyKwh demandKwh fitFloor retailCeiling");

    const points = rows.reverse().map((r) => ({
      t: r.timestamp,
      price: r.clearingPrice,
      supplyKwh: r.supplyKwh,
      demandKwh: r.demandKwh,
      fitFloor: r.fitFloor,
      retailCeiling: r.retailCeiling,
    }));

    return ok({ points });
  } catch (err) {
    return errorResponse(err);
  }
}
