import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { TradeModel } from "@/models/Trade";

// FR-10.x: full trade ledger for the regulator's compliance view — every trade
// with its on-chain anchor (the "chain") and any compliance flag.
export async function GET() {
  try {
    await requireRole("regulator");
    await connectDB();

    const trades = await TradeModel.find()
      .sort({ createdAt: -1 })
      .limit(500)
      .populate<{ sellerId: { name: string } }>("sellerId", "name")
      .populate<{ buyerId: { name: string } }>("buyerId", "name")
      .populate<{ feederId: { code: string } }>("feederId", "code")
      .lean();

    const rows = trades.map((t) => {
      const seller = t.sellerId as unknown as { _id: unknown; name?: string } | null;
      const buyer = t.buyerId as unknown as { _id: unknown; name?: string } | null;
      const feeder = t.feederId as unknown as { code?: string } | null;
      return {
        _id: String(t._id),
        feederCode: feeder?.code ?? "—",
        sellerName: seller?.name ?? "—",
        buyerName: buyer?.name ?? "—",
        quantityKwh: t.quantityKwh,
        pricePerKwh: t.pricePerKwh,
        totalCredits: t.totalCredits,
        status: t.status,
        anchorTxHash: t.anchorTxHash ?? null,
        flagged: !!t.flagged,
        flagReason: t.flagReason ?? null,
        createdAt: t.createdAt,
        settledAt: t.settledAt ?? null,
      };
    });

    return ok(rows);
  } catch (err) {
    return errorResponse(err);
  }
}
