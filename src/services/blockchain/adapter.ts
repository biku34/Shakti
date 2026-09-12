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
import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon, polygonAmoy } from "viem/chains";
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

/** Map the configured network to its viem chain + Alchemy RPC URL. */
function resolveChain(): { chain: typeof polygonAmoy | typeof polygon; rpcUrl: string } {
  const network = env.alchemyNetwork();
  const key = env.alchemyApiKey();
  switch (network) {
    case "polygon-amoy":
      return { chain: polygonAmoy, rpcUrl: `https://polygon-amoy.g.alchemy.com/v2/${key}` };
    case "polygon-mainnet":
      return { chain: polygon, rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${key}` };
    default:
      throw new Error(`Unsupported ALCHEMY_NETWORK: ${network}`);
  }
}

/**
 * Submit the content hash to Polygon via Alchemy (BC-5) and wait for the
 * receipt (BC-6). The 32-byte hash rides in the calldata of a 0-value
 * self-transaction, so it is permanently readable on-chain (getTransaction
 * → input) with no contract to deploy. All signing is server-side (SEC-6).
 */
async function liveSubmit(hash: string): Promise<{ txHash: string; blockNumber: number }> {
  if (!env.alchemyApiKey() || !env.anchorPrivateKey()) {
    throw new Error("Live anchoring requires ALCHEMY_API_KEY and ANCHOR_PRIVATE_KEY");
  }

  const { chain, rpcUrl } = resolveChain();
  const account = privateKeyToAccount(env.anchorPrivateKey() as Hex);
  const transport = http(rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  const txHash = await wallet.sendTransaction({
    to: account.address,
    value: 0n,
    data: hash as Hex,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
  if (receipt.status !== "success") {
    throw new Error(`Anchor tx reverted: ${txHash}`);
  }

  return { txHash, blockNumber: Number(receipt.blockNumber) };
}
