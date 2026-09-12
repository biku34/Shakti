/**
 * REC issuance & lifecycle (§6.6, FR-6.1..FR-6.7). A REC is minted only when
 * backed by verified meter readings whose export sums to the certificate's
 * energy, and those readings are reserved (recBackedKwh) so they cannot back
 * another REC or be double-sold (§3.3 coherence, FR-6.6, FR-6.7).
 */
import { connectDB } from "@/lib/db";
import { MeterModel } from "@/models/Meter";
import { MeterReadingModel } from "@/models/MeterReading";
import { RecCertificateModel } from "@/models/RecCertificate";
import { RecTransactionModel } from "@/models/RecTransaction";
import { UserModel } from "@/models/User";
import { anchorRecord } from "@/services/blockchain/adapter";
import { detectOnRec } from "@/services/fraud/detector";
import { reviewAndFlagRec } from "@/services/fraud/recAiFlag";

const KWH_PER_MWH = 1000;

function serialFor(feederCode: string, seq: number): string {
  const year = new Date().getFullYear();
  return `REC-${feederCode}-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Next serial for a feeder, derived from the highest existing serial for the
 * current year — NOT a document count, which collides once any REC is deleted
 * or revoked (the count no longer equals the top sequence number). Serials are
 * zero-padded and share a fixed prefix, so a lexicographic desc sort finds the
 * max. Callers retry on the unique-index race for concurrent requests.
 */
async function nextSerial(feederCode: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `REC-${feederCode}-${year}-`;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const last = await RecCertificateModel.findOne({ serial: { $regex: `^${escaped}` } })
    .sort({ serial: -1 })
    .select("serial")
    .lean();
  const lastSeq = last ? parseInt(String(last.serial).slice(prefix.length), 10) || 0 : 0;
  return serialFor(feederCode, lastSeq + 1);
}

/**
 * Create a pending REC for a prosumer's meter, reserving verified un-backed
 * export readings that sum to `energyMwh`. Returns the pending certificate.
 */
export async function requestIssuance(params: {
  generatorId: string;
  meterCode: string;
  energyMwh: number;
}): Promise<{ recId: string; serial: string }> {
  await connectDB();
  const meter = await MeterModel.findOne({ code: params.meterCode });
  if (!meter) throw new Error("Unknown meter");
  if (String(meter.ownerId) !== params.generatorId) throw new Error("Meter not owned by generator");

  const needKwh = params.energyMwh * KWH_PER_MWH;

  // The verified-readings query and the feeder lookup both hang off the meter
  // and are independent, so run them together to save a round-trip to Atlas.
  const [readings, feeder] = await Promise.all([
    // Verified readings with un-committed, un-backed export (oldest first).
    MeterReadingModel.find({
      meterId: meter._id,
      verified: true,
      $expr: { $gt: ["$exportKwh", { $add: ["$committedExportKwh", "$recBackedKwh"] }] },
    }).sort({ timestamp: 1 }),
    MeterModel.db.model("Feeder").findById(meter.feederId),
  ]);
  const feederCode = (feeder as { code?: string })?.code ?? "GNR";

  const available = readings.reduce(
    (s, r) => s + (r.exportKwh - r.committedExportKwh - r.recBackedKwh),
    0,
  );
  if (needKwh > available + 1e-6) {
    throw new Error(`Insufficient verified export: need ${needKwh} kWh, have ${available.toFixed(3)} kWh`);
  }

  // Reserve backing readings (FR-6.6 / FR-6.7). Tracked so we can release them
  // if the REC can't be created — a failed request must not drain surplus.
  let toBack = needKwh;
  const backingReadingIds: unknown[] = [];
  const backingReadingKwh: number[] = [];
  const reserved: { id: unknown; take: number }[] = [];
  let from = readings[0].timestamp;
  let to = readings[0].timestamp;
  for (const r of readings) {
    if (toBack <= 1e-6) break;
    const free = r.exportKwh - r.committedExportKwh - r.recBackedKwh;
    const take = Number(Math.min(free, toBack).toFixed(4));
    if (take <= 0) continue;
    reserved.push({ id: r._id, take });
    backingReadingIds.push(r._id);
    backingReadingKwh.push(take);
    if (r.timestamp < from) from = r.timestamp;
    if (r.timestamp > to) to = r.timestamp;
    toBack -= take;
  }

  // Reserve all backing readings in ONE bulk write instead of one save per
  // reading (previously N sequential Atlas round-trips). $inc is atomic, so
  // this is also safer against concurrent reservations than read-modify-save.
  if (reserved.length) {
    await MeterReadingModel.bulkWrite(
      reserved.map((rr) => ({
        updateOne: { filter: { _id: rr.id }, update: { $inc: { recBackedKwh: rr.take } } },
      })),
    );
  }

  try {
    // Retry on the unique-serial race so concurrent requests can't collide.
    for (let attempt = 0; ; attempt++) {
      try {
        const rec = await RecCertificateModel.create({
          serial: await nextSerial(feederCode),
          generatorId: params.generatorId,
          meterId: meter._id,
          feederId: meter.feederId,
          energyMwh: params.energyMwh,
          generationWindow: { from, to },
          backingReadingIds,
          backingReadingKwh,
          status: "pending",
          currentHolderId: params.generatorId,
        });
        return { recId: String(rec._id), serial: rec.serial };
      } catch (err) {
        if ((err as { code?: number })?.code === 11000 && attempt < 5) continue;
        throw err;
      }
    }
  } catch (err) {
    // Release the readings we reserved so the surplus is not silently consumed.
    for (const rr of reserved) {
      await MeterReadingModel.updateOne({ _id: rr.id }, { $inc: { recBackedKwh: -rr.take } });
    }
    throw err;
  }
}

/** Certificate body approves a pending REC → issued + anchored, then scanned (FR-6.2, FR-6.3). */
export async function approveIssuance(
  recId: string,
): Promise<{ issueTxHash: string | null; alertsRaised: number }> {
  await connectDB();
  const rec = await RecCertificateModel.findById(recId);
  if (!rec) throw new Error("REC not found");
  if (rec.status !== "pending") throw new Error(`REC is ${rec.status}, not pending`);

  const anchor = await anchorRecord("rec", recId, {
    serial: rec.serial,
    generatorId: String(rec.generatorId),
    meterId: String(rec.meterId),
    energyMwh: rec.energyMwh,
    generationWindow: rec.generationWindow,
    backingReadingIds: rec.backingReadingIds.map(String),
  });

  // Issuance does NOT mint or pay any credits. The certified green attribute
  // becomes a tradeable certificate held by the generator; the generator earns
  // credits only when they SELL it on the secondary market (purchaseRec). The
  // backing surplus stays reserved (recBackedKwh). Issuance is still anchored
  // on-chain for provenance regardless of any payment.
  rec.status = "issued";
  rec.issueTxHash = anchor.txHash;
  rec.contentHash = anchor.contentHash;
  rec.creditsAwarded = 0;
  await rec.save();

  await RecTransactionModel.create({
    recId: rec._id,
    action: "issue",
    fromId: null,
    toId: rec.currentHolderId,
    anchorTxHash: anchor.txHash,
  });

  // FR-7.1: run REC-level fraud rules on issuance.
  const alertsRaised = await detectOnRec(recId);
  // Auto AI anomaly check on state change (pending → issued), non-blocking.
  void reviewAndFlagRec(recId);
  return { issueTxHash: anchor.txHash, alertsRaised };
}

/**
 * Cancel a *pending* REC request before it is issued. Only the generator can
 * cancel, and only while pending — once issued it can no longer be cancelled.
 * Releases the exact backing readings it reserved so the held surplus returns.
 */
export async function cancelRequest(recId: string, holderId: string): Promise<{ releasedKwh: number }> {
  await connectDB();
  const rec = await RecCertificateModel.findById(recId);
  if (!rec) throw new Error("REC not found");
  if (String(rec.generatorId) !== holderId) throw new Error("Only the generator can cancel this request");
  if (rec.status !== "pending") throw new Error(`Cannot cancel a ${rec.status} REC — only pending requests can be cancelled`);

  // Release the reserved backing so the surplus becomes available again.
  const readings = await MeterReadingModel.find({ _id: { $in: rec.backingReadingIds } });
  const releaseById = new Map<string, number>();
  rec.backingReadingIds.forEach((id, i) => {
    releaseById.set(String(id), rec.backingReadingKwh?.[i] ?? 0);
  });
  let releasedKwh = 0;
  for (const r of readings) {
    const release = releaseById.get(String(r._id)) ?? 0;
    r.recBackedKwh = Number(Math.max(0, r.recBackedKwh - release).toFixed(4));
    await r.save();
    releasedKwh += release;
  }

  // A never-issued request leaves no certificate behind — remove it. The
  // cancellation itself is recorded in the audit log by the API route.
  await RecCertificateModel.deleteOne({ _id: rec._id });
  return { releasedKwh: Number(releasedKwh.toFixed(4)) };
}

/** Clear any active secondary-market listing on a REC document (in place, unsaved). */
function clearListing(rec: { listed?: boolean; askCreditsPerKwh?: number | null; listedAt?: Date | null }): void {
  rec.listed = false;
  rec.askCreditsPerKwh = null;
  rec.listedAt = null;
}

/** Energy of a certificate in kWh — all market pricing is denominated per kWh. */
function energyKwh(energyMwh: number): number {
  return energyMwh * 1000;
}

/** Transfer a REC to a new holder, anchored (FR-6.4). Custody move — no credits. */
export async function transferRec(recId: string, fromId: string, toId: string): Promise<void> {
  await connectDB();
  const rec = await RecCertificateModel.findById(recId);
  if (!rec) throw new Error("REC not found");
  if (String(rec.currentHolderId) !== fromId) throw new Error("Only the current holder can transfer");
  if (!["issued", "transferred"].includes(rec.status)) throw new Error(`Cannot transfer a ${rec.status} REC`);

  const anchor = await anchorRecord("rec_txn", recId, { action: "transfer", recId, fromId, toId, at: new Date() });
  rec.status = "transferred";
  rec.currentHolderId = toId as never;
  clearListing(rec); // ownership changed → any standing listing is void
  await rec.save();
  await RecTransactionModel.create({ recId: rec._id, action: "transfer", fromId, toId, anchorTxHash: anchor.txHash });
  void reviewAndFlagRec(recId); // auto AI check on transfer
}

/**
 * List an issued/transferred REC on the secondary market at `askCreditsPerKwh`.
 * Only the current holder can list; re-listing updates the price. Credits are the
 * only currency, so the ask is denominated in credits per kWh (§ market).
 */
export async function listRecForSale(
  recId: string,
  holderId: string,
  askCreditsPerKwh: number,
): Promise<{ askCreditsPerKwh: number; totalCredits: number }> {
  await connectDB();
  if (!(askCreditsPerKwh > 0)) throw new Error("Ask price must be greater than 0");
  const rec = await RecCertificateModel.findById(recId);
  if (!rec) throw new Error("REC not found");
  if (String(rec.currentHolderId) !== holderId) throw new Error("Only the current holder can list this REC");
  if (!["issued", "transferred"].includes(rec.status)) throw new Error(`Cannot list a ${rec.status} REC`);

  const ask = Number(askCreditsPerKwh.toFixed(4));
  const totalCredits = Number((energyKwh(rec.energyMwh) * ask).toFixed(4));
  rec.listed = true;
  rec.askCreditsPerKwh = ask;
  rec.listedAt = new Date();
  await rec.save();
  await RecTransactionModel.create({ recId: rec._id, action: "list", fromId: holderId, credits: totalCredits });
  void reviewAndFlagRec(recId); // auto AI check when listed on the market
  return { askCreditsPerKwh: ask, totalCredits };
}

/** Remove a REC from the secondary market. Only the current holder can unlist. */
export async function unlistRec(recId: string, holderId: string): Promise<void> {
  await connectDB();
  const rec = await RecCertificateModel.findById(recId);
  if (!rec) throw new Error("REC not found");
  if (String(rec.currentHolderId) !== holderId) throw new Error("Only the current holder can unlist this REC");
  if (!rec.listed) throw new Error("REC is not listed");
  clearListing(rec);
  await rec.save();
  await RecTransactionModel.create({ recId: rec._id, action: "unlist", fromId: holderId });
}

/**
 * Buy a listed REC. Moves credits buyer→seller (the only currency), transfers
 * ownership, anchors the sale on-chain and records it in the provenance trail.
 * Funds-guarded with rollback, mirroring energy-trade settlement (FR-5.3, FR-5.6).
 */
export async function purchaseRec(
  recId: string,
  buyerId: string,
): Promise<{ totalCredits: number; buyerBalance: number; sellerBalance: number; txHash: string | null }> {
  await connectDB();
  const rec = await RecCertificateModel.findById(recId);
  if (!rec) throw new Error("REC not found");
  if (!rec.listed || rec.askCreditsPerKwh == null) throw new Error("REC is not listed for sale");
  if (!["issued", "transferred"].includes(rec.status)) throw new Error(`Cannot buy a ${rec.status} REC`);

  const sellerId = String(rec.currentHolderId);
  if (sellerId === buyerId) throw new Error("You already hold this REC");

  const totalCredits = Number((energyKwh(rec.energyMwh) * rec.askCreditsPerKwh).toFixed(4));
  const [buyer, seller] = await Promise.all([
    UserModel.findById(buyerId),
    UserModel.findById(sellerId),
  ]);
  if (!buyer) throw new Error("Buyer not found");
  if (!seller) throw new Error("Seller not found");
  if (buyer.creditBalance < totalCredits) {
    throw new Error(`Insufficient credits: need ${totalCredits.toFixed(2)} cr, have ${buyer.creditBalance.toFixed(2)} cr`);
  }

  // Debit buyer / credit seller, then transfer + anchor. Roll the money back on
  // any failure so a broken sale never leaves credits moved without ownership.
  buyer.creditBalance = Number((buyer.creditBalance - totalCredits).toFixed(4));
  seller.creditBalance = Number((seller.creditBalance + totalCredits).toFixed(4));
  try {
    await buyer.save();
    await seller.save();

    const anchor = await anchorRecord("rec_txn", recId, {
      action: "sale",
      recId,
      fromId: sellerId,
      toId: buyerId,
      credits: totalCredits,
      at: new Date(),
    });

    rec.status = "transferred";
    rec.currentHolderId = buyerId as never;
    clearListing(rec);
    await rec.save();

    await RecTransactionModel.create({
      recId: rec._id,
      action: "transfer",
      fromId: sellerId,
      toId: buyerId,
      credits: totalCredits,
      anchorTxHash: anchor.txHash,
    });

    void reviewAndFlagRec(recId); // auto AI check on sale (ownership change)
    return {
      totalCredits,
      buyerBalance: buyer.creditBalance,
      sellerBalance: seller.creditBalance,
      txHash: anchor.txHash,
    };
  } catch (err) {
    console.error("[rec] purchase failed, rolling back credits:", err);
    buyer.creditBalance = Number((buyer.creditBalance + totalCredits).toFixed(4));
    seller.creditBalance = Number((seller.creditBalance - totalCredits).toFixed(4));
    await buyer.save().catch(() => {});
    await seller.save().catch(() => {});
    throw err;
  }
}

/** Retire a REC — permanently non-transferable/non-reusable (FR-6.5). */
export async function retireRec(recId: string, holderId: string): Promise<void> {
  await connectDB();
  const rec = await RecCertificateModel.findById(recId);
  if (!rec) throw new Error("REC not found");
  if (String(rec.currentHolderId) !== holderId) throw new Error("Only the current holder can retire");
  if (rec.status === "retired") throw new Error("Already retired");
  if (rec.status === "revoked") throw new Error("Cannot retire a revoked REC");

  const anchor = await anchorRecord("rec_txn", recId, { action: "retire", recId, holderId, at: new Date() });
  rec.status = "retired";
  clearListing(rec); // a retired REC leaves the market permanently
  await rec.save();
  await RecTransactionModel.create({ recId: rec._id, action: "retire", fromId: holderId, toId: null, anchorTxHash: anchor.txHash });
}

/** Revoke a fraudulent REC and release its backing readings (FR-7.7). */
export async function revokeRec(recId: string, actorId: string): Promise<void> {
  await connectDB();
  const rec = await RecCertificateModel.findById(recId);
  if (!rec) throw new Error("REC not found");
  if (rec.status === "revoked") throw new Error("Already revoked");

  const anchor = await anchorRecord("rec_txn", recId, { action: "revoke", recId, actorId, at: new Date() });

  // Release the exact reserved backing so legitimate generation isn't locked.
  const readings = await MeterReadingModel.find({ _id: { $in: rec.backingReadingIds } });
  const releaseById = new Map<string, number>();
  rec.backingReadingIds.forEach((id, i) => {
    releaseById.set(String(id), rec.backingReadingKwh?.[i] ?? 0);
  });
  for (const r of readings) {
    const release = releaseById.get(String(r._id)) ?? 0;
    r.recBackedKwh = Number(Math.max(0, r.recBackedKwh - release).toFixed(4));
    await r.save();
  }

  rec.status = "revoked";
  clearListing(rec); // a revoked REC must not remain purchasable
  await rec.save();
  await RecTransactionModel.create({ recId: rec._id, action: "revoke", fromId: actorId, toId: null, anchorTxHash: anchor.txHash });
}
