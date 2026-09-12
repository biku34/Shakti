import { connectDB } from "@/lib/db";
import { ok, fail, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { BlockchainAnchorModel } from "@/models/BlockchainAnchor";
import { RecCertificateModel } from "@/models/RecCertificate";
import { TradeModel } from "@/models/Trade";
import { UserModel } from "@/models/User";
import { MeterModel } from "@/models/Meter";
import { FeederModel } from "@/models/Feeder";
import {
  verifyRecord,
  readOnChainAnchor,
  type AnchorRefType,
} from "@/services/blockchain/adapter";

// FR-8.4: verify an anchor by its transaction hash — locate the anchored record,
// re-derive its hash, cross-check the on-chain calldata, and return the record
// (the certificate / trade) so the auditor can see exactly what was anchored.
export async function GET(_req: Request, ctx: { params: Promise<{ hash: string }> }) {
  try {
    await requireRole("auditor", "regulator");
    await connectDB();
    const { hash } = await ctx.params;
    const txHash = decodeURIComponent(hash).trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return fail(400, "Enter a 66-character transaction hash (0x + 64 hex).");
    }

    const anchor = await BlockchainAnchorModel.findOne({ txHash });
    if (!anchor) return fail(404, "No anchored record found for this transaction hash.");

    const refType = anchor.refType as AnchorRefType;
    const refId = String(anchor.refId);

    // Read the tx back from the chain and confirm its calldata still carries the
    // anchored hash (only meaningful for real, non-mock anchors).
    const onChainTx = await readOnChainAnchor(txHash);
    const onChain = {
      found: onChainTx.found,
      calldataMatches: onChainTx.found ? onChainTx.calldata === anchor.contentHash : null,
      from: onChainTx.from,
      to: onChainTx.to,
      blockNumber: onChainTx.blockNumber ?? anchor.blockNumber ?? null,
    };

    // Re-derive the record hash (BC-7). Reproducible for rec + trade; rec_txn
    // embeds a submission timestamp we can't reconstruct, so we rely on the
    // on-chain calldata check and the stored anchor for those.
    let hashMatch: { verified: boolean; expected: string; actual: string } | null = null;
    let subject: Record<string, unknown> | null = null;

    if (refType === "rec") {
      const rec = await RecCertificateModel.findById(refId);
      if (!rec) return fail(404, "Anchored REC no longer exists.");
      const record = {
        serial: rec.serial,
        generatorId: String(rec.generatorId),
        meterId: String(rec.meterId),
        energyMwh: rec.energyMwh,
        generationWindow: rec.generationWindow,
        backingReadingIds: rec.backingReadingIds.map(String),
      };
      const v = await verifyRecord("rec", refId, record);
      hashMatch = { verified: v.verified, expected: v.expected, actual: v.actual };
      subject = await recSubject(rec);
    } else if (refType === "rec_txn") {
      // refId is the REC the lifecycle event belongs to.
      const rec = await RecCertificateModel.findById(refId);
      if (rec) subject = await recSubject(rec);
    } else if (refType === "trade") {
      const trade = await TradeModel.findById(refId);
      if (!trade) return fail(404, "Anchored trade no longer exists.");
      const record = {
        offerId: String(trade.offerId),
        bidId: String(trade.bidId),
        sellerId: String(trade.sellerId),
        buyerId: String(trade.buyerId),
        feederId: String(trade.feederId),
        quantityKwh: trade.quantityKwh,
        pricePerKwh: trade.pricePerKwh,
        totalCredits: trade.totalCredits,
      };
      const v = await verifyRecord("trade", refId, record);
      hashMatch = { verified: v.verified, expected: v.expected, actual: v.actual };
      subject = await tradeSubject(trade);
    }

    return ok({
      txHash,
      refType,
      refId,
      network: anchor.network,
      anchorStatus: anchor.status,
      contentHash: anchor.contentHash,
      anchoredAt: anchor.createdAt,
      hashMatch,
      onChain,
      subject,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

async function name(id: unknown): Promise<string | null> {
  if (!id) return null;
  const u = await UserModel.findById(id).select("name role").lean();
  return u ? (u as { name: string }).name : null;
}

async function recSubject(rec: {
  _id: unknown; serial: string; energyMwh: number; status: string; createdAt: Date;
  generationWindow?: { from: Date; to: Date } | null; creditsAwarded?: number;
  generatorId: unknown; meterId: unknown; feederId: unknown; currentHolderId: unknown;
  issueTxHash?: string | null;
}) {
  const [meter, feeder, generator, holder] = await Promise.all([
    MeterModel.findById(rec.meterId).select("code solarCapacityKw").lean(),
    FeederModel.findById(rec.feederId).select("name code").lean(),
    name(rec.generatorId),
    name(rec.currentHolderId),
  ]);
  return {
    kind: "rec" as const,
    id: String(rec._id),
    serial: rec.serial,
    energyMwh: rec.energyMwh,
    status: rec.status,
    createdAt: rec.createdAt,
    generationWindow: rec.generationWindow,
    creditsAwarded: rec.creditsAwarded ?? 0,
    generator,
    currentHolder: holder,
    meter: meter ? { code: (meter as { code: string }).code, solarCapacityKw: (meter as { solarCapacityKw: number }).solarCapacityKw } : null,
    feeder: feeder ? { name: (feeder as { name: string }).name, code: (feeder as { code: string }).code } : null,
    issueTxHash: rec.issueTxHash ?? null,
  };
}

async function tradeSubject(trade: {
  _id: unknown; quantityKwh: number; pricePerKwh: number; totalCredits: number;
  status: string; settledAt?: Date | null; createdAt: Date;
  sellerId: unknown; buyerId: unknown; feederId: unknown;
}) {
  const [seller, buyer, feeder] = await Promise.all([
    name(trade.sellerId),
    name(trade.buyerId),
    FeederModel.findById(trade.feederId).select("name code").lean(),
  ]);
  return {
    kind: "trade" as const,
    id: String(trade._id),
    quantityKwh: trade.quantityKwh,
    pricePerKwh: trade.pricePerKwh,
    totalCredits: trade.totalCredits,
    status: trade.status,
    settledAt: trade.settledAt ?? null,
    createdAt: trade.createdAt,
    seller,
    buyer,
    feeder: feeder ? { name: (feeder as { name: string }).name, code: (feeder as { code: string }).code } : null,
  };
}
