import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { EnergyBidModel } from "@/models/EnergyBid";

// A consumer's own bids (for the "Place Bid" management screen).
export async function GET() {
  try {
    const session = await requireRole("consumer");
    await connectDB();
    const bids = await EnergyBidModel.find({ consumerId: session.userId }).sort({ createdAt: -1 });
    return ok(bids);
  } catch (err) {
    return errorResponse(err);
  }
}
