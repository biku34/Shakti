/**
 * Trade matching & settlement (§6.5, FR-5.1..FR-5.6).
 *
 * Matching is symmetric: a new BID matches the cheapest compatible resting
 * OFFERS, and a new OFFER matches the compatible resting BIDS — both in the same
 * feeder, with askPrice ≤ bid.maxPrice. Partial fills supported. Each fill:
 * computes credits, debits buyer, credits seller, records a Trade, and anchors
 * its content hash on-chain off the critical path (§8.2). Settlement failure
 * rolls back the credit move and marks the trade `failed`.
 *
 * NOTE: true multi-document atomicity (FR-5.6, NFR-R2) needs a MongoDB
 * transaction (Atlas replica set). The scaffold performs guarded sequential
 * updates and rolls back credit moves on error; wrap in a session for prod.
 */
import { type HydratedDocument } from "mongoose";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";
import { EnergyOfferModel, type EnergyOffer } from "@/models/EnergyOffer";
import { EnergyBidModel, type EnergyBid } from "@/models/EnergyBid";
import { TradeModel } from "@/models/Trade";
import { FeederModel } from "@/models/Feeder";
import { anchorRecord } from "@/services/blockchain/adapter";
import { isTradingSuspended } from "@/services/trading/controls";
import { audit } from "@/services/audit";

const EPS = 1e-6;

export type MatchResult = {
  trades: string[];
  filledKwh: number;
};

type HydratedOffer = HydratedDocument<EnergyOffer>;
type HydratedBid = HydratedDocument<EnergyBid>;
type AnchorItem = { tradeId: string; record: Record<string, unknown> };

/**
 * Match a newly-placed BID against the cheapest compatible resting offers in the
 * same feeder (askPrice ≤ bid.maxPrice), cheapest then oldest first (FR-5.1).
 */
export async function matchBid(bidId: string): Promise<MatchResult> {
  await connectDB();
  const bid = await EnergyBidModel.findById(bidId);
  if (!bid || !["open", "partial"].includes(bid.status)) return { trades: [], filledKwh: 0 };

  // Respect a regulator trading suspension on this feeder — no settlement.
  const feeder = await FeederModel.findById(bid.feederId);
  if (isTradingSuspended(feeder)) return { trades: [], filledKwh: 0 };

  const offers = await EnergyOfferModel.find({
    feederId: bid.feederId,
    status: { $in: ["open", "partial"] },
    askPricePerKwh: { $lte: bid.maxPricePerKwh },
    remainingKwh: { $gt: 0 },
  }).sort({ askPricePerKwh: 1, createdAt: 1 });

  const tradeIds: string[] = [];
  const toAnchor: AnchorItem[] = [];
  let filled = 0;

  for (const offer of offers) {
    if (bid.remainingKwh <= EPS) break;
    const r = await settleFill(offer, bid);
    if (r.tradeId) tradeIds.push(r.tradeId);
    if (r.anchor) toAnchor.push(r.anchor);
    filled += r.filled;
  }

  if (toAnchor.length) void anchorTradesInBackground(toAnchor);
  return { trades: tradeIds, filledKwh: Number(filled.toFixed(4)) };
}

/**
 * Match a newly-placed OFFER against the compatible resting bids in the same
 * feeder (bid.maxPrice ≥ ask), oldest first (FIFO — the price paid is the
 * offer's ask either way). This is the mirror of matchBid: without it, a sell
 * placed *after* a compatible buy would never settle, because only the taker
 * side ran matching (the bug that left crossing orders resting forever).
 */
export async function matchOffer(offerId: string): Promise<MatchResult> {
  await connectDB();
  const offer = await EnergyOfferModel.findById(offerId);
  if (!offer || !["open", "partial"].includes(offer.status)) return { trades: [], filledKwh: 0 };

  const feeder = await FeederModel.findById(offer.feederId);
  if (isTradingSuspended(feeder)) return { trades: [], filledKwh: 0 };

  const bids = await EnergyBidModel.find({
    feederId: offer.feederId,
    status: { $in: ["open", "partial"] },
    maxPricePerKwh: { $gte: offer.askPricePerKwh },
    remainingKwh: { $gt: 0 },
  }).sort({ createdAt: 1 });

  const tradeIds: string[] = [];
  const toAnchor: AnchorItem[] = [];
  let filled = 0;

  for (const bid of bids) {
    if (offer.remainingKwh <= EPS) break;
    const r = await settleFill(offer, bid);
    if (r.tradeId) tradeIds.push(r.tradeId);
    if (r.anchor) toAnchor.push(r.anchor);
    filled += r.filled;
  }

  if (toAnchor.length) void anchorTradesInBackground(toAnchor);
  return { trades: tradeIds, filledKwh: Number(filled.toFixed(4)) };
}

/**
 * Settle a single fill between one offer and one bid: self-trade guard, funds
 * guard, credit move, Trade record, and quantity/status updates on both order
 * docs (which it mutates and saves). Rolls back the credit move on error. The
 * on-chain anchor is returned, not awaited, so the caller anchors off the
 * critical path. Shared by both matching directions so the money logic is
 * identical whichever side is the taker.
 */
async function settleFill(
  offer: HydratedOffer,
  bid: HydratedBid,
): Promise<{ tradeId: string | null; filled: number; anchor?: AnchorItem }> {
  const nil = { tradeId: null, filled: 0 };
  if (String(offer.prosumerId) === String(bid.consumerId)) return nil; // no self-trade

  const qty = Math.min(bid.remainingKwh, offer.remainingKwh);
  if (qty <= EPS) return nil;

  // Settlement price: use the offer's ask (price-time priority, seller's terms).
  const price = offer.askPricePerKwh;
  const totalCredits = Number((qty * price).toFixed(4));

  const buyer = await UserModel.findById(bid.consumerId);
  const seller = await UserModel.findById(offer.prosumerId);
  if (!buyer || !seller) return nil;

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
    return nil; // caller moves on to the next counterparty
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

    // Off-chain settlement is complete → the trade is settled now. Anchoring the
    // content hash to Polygon (FR-5.4, §8.2) waits for a block confirmation
    // (seconds) and is best-effort/isolated (BC-8), so it must NOT block
    // settlement — the caller anchors it after responding; anchorTxHash is
    // back-filled when the receipt lands.
    trade.status = "settled";
    trade.settledAt = new Date();
    await trade.save();

    void audit(String(buyer._id), "trade.settled", { type: "trade", id: String(trade._id) }, {
      qty,
      price,
      totalCredits,
    }).catch((e) => console.error("[audit] trade.settled failed:", e));

    return {
      tradeId: String(trade._id),
      filled: qty,
      anchor: {
        tradeId: String(trade._id),
        record: {
          offerId: String(offer._id),
          bidId: String(bid._id),
          sellerId: String(seller._id),
          buyerId: String(buyer._id),
          feederId: String(bid.feederId),
          quantityKwh: qty,
          pricePerKwh: price,
          totalCredits,
        },
      },
    };
  } catch (err) {
    // Roll back the credit move; mark the trade failed (FR-5.6).
    console.error("[matching] settlement failed, rolling back:", err);
    buyer.creditBalance = Number((buyer.creditBalance + totalCredits).toFixed(4));
    seller.creditBalance = Number((seller.creditBalance - totalCredits).toFixed(4));
    await buyer.save().catch(() => {});
    await seller.save().catch(() => {});
    trade.status = "failed";
    await trade.save().catch(() => {});
    return nil;
  }
}

/**
 * Anchor settled trades to Polygon AFTER settlement returns. The live submit
 * waits for a block confirmation (seconds) and is best-effort/isolated (BC-8,
 * FR-5.4), so it must never gate the trade. Sequential to avoid nonce races on
 * the shared anchor account; each back-fills its trade's anchorTxHash.
 */
async function anchorTradesInBackground(items: AnchorItem[]): Promise<void> {
  for (const { tradeId, record } of items) {
    try {
      const anchor = await anchorRecord("trade", tradeId, record);
      if (anchor.txHash) {
        await TradeModel.updateOne({ _id: tradeId }, { $set: { anchorTxHash: anchor.txHash } });
      }
    } catch (err) {
      console.error("[matching] background trade anchor failed:", tradeId, err);
    }
  }
}
