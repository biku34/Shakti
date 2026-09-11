import { connectDB } from "@/lib/db";
import { ok, fail, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { EnergyOfferModel } from "@/models/EnergyOffer";
import { EnergyBidModel } from "@/models/EnergyBid";
import { computeAndSnapshotPrice } from "@/services/trading/pricing";

// FR-3.4 / FR-3.6: live order book scoped to a feeder + current clearing price.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("prosumer", "consumer", "utility", "regulator");
    await connectDB();
    const { id: feederId } = await ctx.params;

    // Locality scoping (FR-1.6): prosumers/consumers only see their own feeder.
    if (["prosumer", "consumer"].includes(session.role) && session.feederId !== feederId) {
      return fail(403, "Order book is scoped to your feeder");
    }

    const [offers, bids, pricing] = await Promise.all([
      EnergyOfferModel.find({ feederId, status: { $in: ["open", "partial"] } }).sort({ askPricePerKwh: 1 }),
      EnergyBidModel.find({ feederId, status: { $in: ["open", "partial"] } }).sort({ maxPricePerKwh: -1 }),
      computeAndSnapshotPrice(feederId),
    ]);

    return ok({ feederId, offers, bids, pricing });
  } catch (err) {
    return errorResponse(err);
  }
}
