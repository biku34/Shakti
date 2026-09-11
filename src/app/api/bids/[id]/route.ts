import { connectDB } from "@/lib/db";
import { ok, fail, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { EnergyBidModel } from "@/models/EnergyBid";
import { audit } from "@/services/audit";

// FR-3.5: cancel a bid while open|partial.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("consumer", "prosumer");
    await connectDB();
    const { id } = await ctx.params;

    const bid = await EnergyBidModel.findById(id);
    if (!bid) return fail(404, "Bid not found");
    if (String(bid.consumerId) !== session.userId) return fail(403, "Not your bid");
    if (!["open", "partial"].includes(bid.status)) {
      return fail(409, `Cannot cancel bid in status ${bid.status}`);
    }

    bid.status = "cancelled";
    await bid.save();
    await audit(session.userId, "bid.cancel", { type: "bid", id });
    return ok({ cancelled: true });
  } catch (err) {
    return errorResponse(err);
  }
}
