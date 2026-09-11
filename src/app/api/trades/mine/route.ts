import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { TradeModel } from "@/models/Trade";

// GET /api/trades/mine — trades where the caller is buyer or seller.
export async function GET() {
  try {
    const session = await requireRole("prosumer", "consumer");
    await connectDB();
    const trades = await TradeModel.find({
      $or: [{ sellerId: session.userId }, { buyerId: session.userId }],
    }).sort({ createdAt: -1 });
    return ok(trades);
  } catch (err) {
    return errorResponse(err);
  }
}
