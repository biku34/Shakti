import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { TradeModel } from "@/models/Trade";

// FR-9.3: settlement summary per feeder (settled trades, energy, credits).
export async function GET() {
  try {
    await requireRole("utility", "regulator");
    await connectDB();
    const rows = await TradeModel.aggregate([
      { $match: { status: "settled" } },
      {
        $group: {
          _id: "$feederId",
          trades: { $sum: 1 },
          energyKwh: { $sum: "$quantityKwh" },
          credits: { $sum: "$totalCredits" },
          sellers: { $addToSet: "$sellerId" },
          buyers: { $addToSet: "$buyerId" },
          lastSettledAt: { $max: "$settledAt" },
        },
      },
    ]);
    return ok(
      rows.map((r) => ({
        feederId: String(r._id),
        trades: r.trades,
        energyKwh: Number(r.energyKwh.toFixed(3)),
        credits: Number(r.credits.toFixed(2)),
        avgPricePerKwh: r.energyKwh > 0 ? Number((r.credits / r.energyKwh).toFixed(3)) : 0,
        sellers: r.sellers.length,
        buyers: r.buyers.length,
        lastSettledAt: r.lastSettledAt ?? null,
      })),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
