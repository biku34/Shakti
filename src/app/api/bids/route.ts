import { z } from "zod";
import { connectDB } from "@/lib/db";
import { ok, fail, parseBody, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { EnergyBidModel } from "@/models/EnergyBid";
import { matchBid } from "@/services/trading/matching";
import { audit } from "@/services/audit";

const schema = z.object({
  quantityKwh: z.number().positive(),
  maxPricePerKwh: z.number().positive(),
  expiresInMinutes: z.number().positive().max(1440).default(120),
});

// FR-3.3: a consumer places a bid; matching runs immediately (§6.5).
export async function POST(req: Request) {
  try {
    // Consumers buy; prosumers can also buy (they draw energy at night).
    const session = await requireRole("consumer", "prosumer");
    if (!session.feederId) return fail(400, "User is not bound to a feeder");
    await connectDB();
    const body = await parseBody(req, schema);

    const bid = await EnergyBidModel.create({
      consumerId: session.userId,
      feederId: session.feederId,
      quantityKwh: body.quantityKwh,
      remainingKwh: body.quantityKwh,
      maxPricePerKwh: body.maxPricePerKwh,
      expiresAt: new Date(Date.now() + body.expiresInMinutes * 60 * 1000),
    });

    await audit(session.userId, "bid.create", { type: "bid", id: String(bid._id) });

    const match = await matchBid(String(bid._id));
    const refreshed = await EnergyBidModel.findById(bid._id);
    return ok({ bid: refreshed, match });
  } catch (err) {
    return errorResponse(err);
  }
}
