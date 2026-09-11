/**
 * Server-side blockchain adapter (§8). ALL Polygon interaction happens here —
 * never in the browser (DC-2, BC-2, FR-8.1, SEC-6).
 *
 * Two modes:
 *   - MOCK (default, BLOCKCHAIN_MOCK=true): records a deterministic pseudo tx
 *     hash so the whole demo runs offline with no funded account.
 *   - LIVE: submits the content hash to Polygon Amoy via Alchemy. Real signing
 *     requires a wallet lib (viem/ethers) + funded ANCHOR_PRIVATE_KEY; the
 *     integration point is marked below so it can be filled in without touching
 *     any caller (BC-5, BC-8).
 *
 * Anchoring is best-effort and isolated: a chain failure returns a `pending`
 * anchor and never throws into the core off-chain flow (BC-8, NFR-R1).
 */
import { createHash } from "crypto";
import { connectDB } from "@/lib/db";
import { env } from "@/lib/env";
import { BlockchainAnchorModel } from "@/models/BlockchainAnchor";
import { contentHash } from "./hash";

export type AnchorRefType = "rec" | "trade" | "rec_txn";

export type AnchorResult = {
  contentHash: string;
  txHash: string | null;
  blockNumber: number;
  status: "pending" | "confirmed" | "failed";
};

/**
 * Anchor a record: compute its content hash, submit it to chain (or mock),
 * and persist a BlockchainAnchor row. Returns the result for the caller to
 * store alongside its own record (issueTxHash / anchorTxHash).
 */
export async function anchorRecord(
  refType: AnchorRefType,
  refId: string,
  record: unknown,
): Promise<AnchorResult> {
  await connectDB();
  const hash = contentHash(record);

  const anchor = await BlockchainAnchorModel.create({
    refType,
    refId,
    contentHash: hash,
    network: env.alchemyNetwork(),
    status: "pending",
  });

  try {
    const submitted = env.blockchainMock()
      ? mockSubmit(hash)
      : await liveSubmit(hash);

    anchor.txHash = submitted.txHash;
    anchor.blockNumber = submitted.blockNumber;
    anchor.status = "confirmed";
    await anchor.save();

    return { contentHash: hash, ...submitted, status: "confirmed" };
  } catch (err) {
    // BC-8: never let chain errors corrupt off-chain state; leave anchor pending.
    console.error("[blockchain] anchor failed, left pending:", err);
    return { contentHash: hash, txHash: null, blockNumber: 0, status: "pending" };
  }
}

/**
 * Re-derive the hash from the current record and confirm it matches what was
 * anchored (BC-7, FR-8.4). Any mismatch is a tamper indicator.
 */
export async function verifyRecord(
  refType: AnchorRefType,
  refId: string,
  currentRecord: unknown,
): Promise<{ verified: boolean; expected: string; actual: string; txHash: string | null }> {
  await connectDB();
  const anchor = await BlockchainAnchorModel.findOne({ refType, refId }).sort({ createdAt: -1 });
  const actual = contentHash(currentRecord);
  const expected = anchor?.contentHash ?? "";
  return {
    verified: !!anchor && expected === actual,
    expected,
    actual,
    txHash: anchor?.txHash ?? null,
  };
}

// ─── MOCK submission ────────────────────────────────────────────────
function mockSubmit(hash: string): { txHash: string; blockNumber: number } {
  const txHash = "0x" + createHash("sha256").update("tx:" + hash + Date.now()).digest("hex");
  const blockNumber = Math.floor(Date.now() / 1000);
  return { txHash, blockNumber };
}

// ─── LIVE submission (Alchemy → Polygon Amoy) ───────────────────────
async function liveSubmit(_hash: string): Promise<{ txHash: string; blockNumber: number }> {
  // INTEGRATION POINT (BC-5): sign a tx whose calldata carries `_hash` and send
  // it via Alchemy using viem/ethers + ANCHOR_PRIVATE_KEY, then poll for the
  // receipt (BC-6). Kept out of the scaffold so it builds with zero secrets.
  if (!env.alchemyApiKey() || !env.anchorPrivateKey()) {
    throw new Error("Live anchoring requires ALCHEMY_API_KEY and ANCHOR_PRIVATE_KEY");
  }
  throw new Error("Live anchoring not implemented in scaffold — set BLOCKCHAIN_MOCK=true");
}
