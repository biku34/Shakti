import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { FeederModel } from "@/models/Feeder";
import { PricingSnapshotModel } from "@/models/PricingSnapshot";
import { priceBounds, isTradingSuspended } from "@/services/trading/controls";

// Per-feeder market state for the regulator: live clearing price, the regulated
// price band, and whether trading is currently suspended.
export async function GET() {
  try {
    await requireRole("regulator");
    await connectDB();
    const feeders = await FeederModel.find().sort({ code: 1 }).lean();

    // Latest clearing price per feeder.
    const snaps = await PricingSnapshotModel.aggregate<{ _id: unknown; clearingPrice: number }>([
      { $sort: { timestamp: -1 } },
      { $group: { _id: "$feederId", clearingPrice: { $first: "$clearingPrice" } } },
    ]);
    const priceByFeeder = new Map(snaps.map((s) => [String(s._id), s.clearingPrice]));

    const rows = feeders.map((f) => {
      const { floor, ceiling } = priceBounds(f);
      return {
        _id: String(f._id),
        code: f.code,
        name: f.name,
        congestionLevel: f.congestionLevel,
        clearingPrice: priceByFeeder.get(String(f._id)) ?? null,
        priceFloorPerKwh: f.priceFloorPerKwh ?? null,
        priceCeilingPerKwh: f.priceCeilingPerKwh ?? null,
        effectiveFloor: floor,
        effectiveCeiling: ceiling,
        tradingSuspendedUntil: f.tradingSuspendedUntil ?? null,
        suspended: isTradingSuspended(f),
      };
    });
    return ok(rows);
  } catch (err) {
    return errorResponse(err);
  }
}
