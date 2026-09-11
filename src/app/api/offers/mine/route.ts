import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { EnergyOfferModel } from "@/models/EnergyOffer";

// A prosumer's own sell offers (for the "Sell Surplus" management screen).
export async function GET() {
  try {
    const session = await requireRole("prosumer");
    await connectDB();
    const offers = await EnergyOfferModel.find({ prosumerId: session.userId }).sort({
      createdAt: -1,
    });
    return ok(offers);
  } catch (err) {
    return errorResponse(err);
  }
}
