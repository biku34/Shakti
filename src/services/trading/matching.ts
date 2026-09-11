/**
 * Trade matching & settlement (§6.5, FR-5.1..FR-5.6).
 *
 * A bid is matched against the cheapest compatible offers in the SAME feeder
 * (askPrice ≤ bid.maxPrice), supporting partial fills. Each fill: computes
 * credits, debits buyer, credits seller, records a Trade, and anchors its
 * content hash on-chain (§8.2). Settlement failure marks the trade `failed`.
 *
 * NOTE: true multi-document atomicity (FR-5.6, NFR-R2) needs a MongoDB
 * transaction (Atlas replica set). The scaffold performs guarded sequential
 * updates and rolls back credit moves on error; wrap in a session for prod.
 */
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";
import { EnergyOfferModel } from "@/models/EnergyOffer";
import { EnergyBidModel } from "@/models/EnergyBid";
import { TradeModel } from "@/models/Trade";
import { anchorRecord } from "@/services/blockchain/adapter";
import { audit } from "@/services/audit";

const EPS = 1e-6;

export type MatchResult = {
  trades: string[];
  filledKwh: number;
};

export async function matchBid(bidId: string): Promise<MatchResult> {
  await connectDB();
  const bid = await EnergyBidModel.findById(bidId);
  if (!bid || !["open", "partial"].includes(bid.status)) {
    return { trades: [], filledKwh: 0 };
  }

  // FR-5.1: cheapest compatible offers first, same feeder.
  const offers = await EnergyOfferModel.find({
    feederId: bid.feederId,
    status: { $in: ["open", "partial"] },
    askPricePerKwh: { $lte: bid.maxPricePerKwh },
    remainingKwh: { $gt: 0 },
  }).sort({ askPricePerKwh: 1, createdAt: 1 });

  const tradeIds: string[] = [];
  let filled = 0;

  for (const offer of offers) {
    if (bid.remainingKwh <= EPS) break;
    if (String(offer.prosumerId) === String(bid.consumerId)) continue; // no self-trade

    const qty = Math.min(bid.remainingKwh, offer.remainingKwh);
    if (qty <= EPS) continue;

    // Settlement price: use the offer's ask (price-time priority, seller's terms).
    const price = offer.askPricePerKwh;
    const totalCredits = Number((qty * price).toFixed(4));

    const buyer = await UserModel.findById(bid.consumerId);
    const seller = await UserModel.findById(offer.prosumerId);
    if (!buyer || !seller) continue;

    // FR-5.6: guard on funds before mutating anything.
    if (buyer.creditBalance < totalCredits) {
      await TradeModel.create({
        offerId: offer._id,
        bidId: bid._id,
        sellerId: seller._id,
        buyerId: buyer._id,
        feederId: bid.feederId,
        quantityKwh: qty,
        pricePerKwh: price,
        totalCredits,
        status: "failed",
      });
      continue; // try the next offer; buyer can't afford this fill
    }

    // Debit buyer / credit seller (FR-5.3).
    buyer.creditBalance = Number((buyer.creditBalance - totalCredits).toFixed(4));
    seller.creditBalance = Number((seller.creditBalance + totalCredits).toFixed(4));

    const trade = await TradeModel.create({
      offerId: offer._id,
      bidId: bid._id,
      sellerId: seller._id,
      buyerId: buyer._id,
      feederId: bid.feederId,
      quantityKwh: qty,
      pricePerKwh: price,
      totalCredits,
      status: "matched",
    });

    try {
      await buyer.save();
      await seller.save();

      // Reduce remaining quantities & update statuses.
      offer.remainingKwh = Number((offer.remainingKwh - qty).toFixed(4));
      offer.status = offer.remainingKwh <= EPS ? "filled" : "partial";
      await offer.save();

      bid.remainingKwh = Number((bid.remainingKwh - qty).toFixed(4));
      bid.status = bid.remainingKwh <= EPS ? "filled" : "partial";
      await bid.save();

      // FR-5.4: anchor the trade's content hash on Polygon (§8.2).
      const anchor = await anchorRecord("trade", String(trade._id), {
        offerId: String(offer._id),
        bidId: String(bid._id),
        sellerId: String(seller._id),
        buyerId: String(buyer._id),
        feederId: String(bid.feederId),
        quantityKwh: qty,
        pricePerKwh: price,
        totalCredits,
      });

      trade.status = "settled";
      trade.anchorTxHash = anchor.txHash;
      trade.settledAt = new Date();
      await trade.save();

      await audit(String(buyer._id), "trade.settled", { type: "trade", id: String(trade._id) }, {
        qty,
        price,
        totalCredits,
      });

      tradeIds.push(String(trade._id));
      filled += qty;
    } catch (err) {
      // Roll back the credit move; mark the trade failed (FR-5.6).
      console.error("[matching] settlement failed, rolling back:", err);
      buyer.creditBalance = Number((buyer.creditBalance + totalCredits).toFixed(4));
      seller.creditBalance = Number((seller.creditBalance - totalCredits).toFixed(4));
      await buyer.save().catch(() => {});
      await seller.save().catch(() => {});
      trade.status = "failed";
      await trade.save().catch(() => {});
    }
  }

  return { trades: tradeIds, filledKwh: Number(filled.toFixed(4)) };
}
