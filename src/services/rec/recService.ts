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
import { anchorRecord } from "@/services/blockchain/adapter";
import { detectOnRec } from "@/services/fraud/detector";

const KWH_PER_MWH = 1000;

function serialFor(feederCode: string, seq: number): string {
  const year = new Date().getFullYear();
  return `REC-${feederCode}-${year}-${String(seq).padStart(6, "0")}`;
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

  // Verified readings with un-committed, un-backed export (oldest first).
  const readings = await MeterReadingModel.find({
    meterId: meter._id,
    verified: true,
    $expr: { $gt: ["$exportKwh", { $add: ["$committedExportKwh", "$recBackedKwh"] }] },
  }).sort({ timestamp: 1 });

  const available = readings.reduce(
    (s, r) => s + (r.exportKwh - r.committedExportKwh - r.recBackedKwh),
    0,
  );
  if (needKwh > available + 1e-6) {
    throw new Error(`Insufficient verified export: need ${needKwh} kWh, have ${available.toFixed(3)} kWh`);
  }

  // Reserve backing readings (FR-6.6 / FR-6.7).
  let toBack = needKwh;
  const backingReadingIds: unknown[] = [];
  const backingReadingKwh: number[] = [];
  let from = readings[0].timestamp;
  let to = readings[0].timestamp;
  for (const r of readings) {
    if (toBack <= 1e-6) break;
    const free = r.exportKwh - r.committedExportKwh - r.recBackedKwh;
    const take = Math.min(free, toBack);
    r.recBackedKwh = Number((r.recBackedKwh + take).toFixed(4));
    await r.save();
    backingReadingIds.push(r._id);
    backingReadingKwh.push(Number(take.toFixed(4)));
    if (r.timestamp < from) from = r.timestamp;
    if (r.timestamp > to) to = r.timestamp;
    toBack -= take;
  }

  const seq = (await RecCertificateModel.countDocuments({ feederId: meter.feederId })) + 1;
  const feeder = await MeterModel.db.model("Feeder").findById(meter.feederId);
  const feederCode = (feeder as { code?: string })?.code ?? "GNR";

  const rec = await RecCertificateModel.create({
    serial: serialFor(feederCode, seq),
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
}

/** Certificate body approves a pending REC → issued + anchored, then scanned (FR-6.2, FR-6.3). */
export async function approveIssuance(recId: string): Promise<{ issueTxHash: string | null; alertsRaised: number }> {
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

  rec.status = "issued";
  rec.issueTxHash = anchor.txHash;
  rec.contentHash = anchor.contentHash;
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
  return { issueTxHash: anchor.txHash, alertsRaised };
}

/** Transfer a REC to a new holder, anchored (FR-6.4). */
export async function transferRec(recId: string, fromId: string, toId: string): Promise<void> {
  await connectDB();
  const rec = await RecCertificateModel.findById(recId);
  if (!rec) throw new Error("REC not found");
  if (String(rec.currentHolderId) !== fromId) throw new Error("Only the current holder can transfer");
  if (!["issued", "transferred"].includes(rec.status)) throw new Error(`Cannot transfer a ${rec.status} REC`);

  const anchor = await anchorRecord("rec_txn", recId, { action: "transfer", recId, fromId, toId, at: new Date() });
  rec.status = "transferred";
  rec.currentHolderId = toId as never;
  await rec.save();
  await RecTransactionModel.create({ recId: rec._id, action: "transfer", fromId, toId, anchorTxHash: anchor.txHash });
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
  await rec.save();
  await RecTransactionModel.create({ recId: rec._id, action: "revoke", fromId: actorId, toId: null, anchorTxHash: anchor.txHash });
}
