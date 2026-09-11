import { connectDB } from "@/lib/db";
import { ok, fail, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { RecCertificateModel } from "@/models/RecCertificate";
import { TradeModel } from "@/models/Trade";
import { verifyRecord, type AnchorRefType } from "@/services/blockchain/adapter";

// FR-8.4: re-derive a record's hash and confirm it matches the on-chain anchor.
export async function GET(_req: Request, ctx: { params: Promise<{ refType: string; refId: string }> }) {
  try {
    await requireRole("auditor", "regulator");
    await connectDB();
    const { refType, refId } = await ctx.params;

    let record: unknown;
    if (refType === "rec") {
      const rec = await RecCertificateModel.findById(refId);
      if (!rec) return fail(404, "REC not found");
      record = {
        serial: rec.serial,
        generatorId: String(rec.generatorId),
        meterId: String(rec.meterId),
        energyMwh: rec.energyMwh,
        generationWindow: rec.generationWindow,
        backingReadingIds: rec.backingReadingIds.map(String),
      };
    } else if (refType === "trade") {
      const trade = await TradeModel.findById(refId);
      if (!trade) return fail(404, "Trade not found");
      record = {
        offerId: String(trade.offerId),
        bidId: String(trade.bidId),
        sellerId: String(trade.sellerId),
        buyerId: String(trade.buyerId),
        feederId: String(trade.feederId),
        quantityKwh: trade.quantityKwh,
        pricePerKwh: trade.pricePerKwh,
        totalCredits: trade.totalCredits,
      };
    } else {
      return fail(400, "Unsupported refType (use 'rec' or 'trade')");
    }

    const verification = await verifyRecord(refType as AnchorRefType, refId, record);
    return ok(verification);
  } catch (err) {
    return errorResponse(err);
  }
}
