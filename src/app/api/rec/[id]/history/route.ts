import { connectDB } from "@/lib/db";
import { ok, fail, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { RecCertificateModel } from "@/models/RecCertificate";
import { RecTransactionModel } from "@/models/RecTransaction";
import { UserModel } from "@/models/User";

// Public provenance chain of a certificate: issuance → every transfer/sale →
// retirement/revocation, each with its on-chain anchor hash and the parties.
// RECs are meant to be verifiable, so any authenticated user may read this.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole();
    await connectDB();
    const { id } = await ctx.params;

    const rec = await RecCertificateModel.findById(id).lean();
    if (!rec) return fail(404, "REC not found");

    // Only the anchored ownership-chain events (skip list/unlist market noise).
    const txns = await RecTransactionModel.find({
      recId: rec._id,
      action: { $in: ["issue", "transfer", "retire", "revoke"] },
    })
      .sort({ timestamp: 1 })
      .lean();

    const ids = [
      ...new Set(
        txns.flatMap((t) => [t.fromId, t.toId]).filter(Boolean).map((x) => String(x)),
      ),
    ];
    const users = await UserModel.find({ _id: { $in: ids } }).select("name role").lean();
    const byId = new Map(users.map((u) => [String(u._id), u as { name?: string; role?: string }]));
    const nameOf = (uid: unknown) => (uid ? byId.get(String(uid))?.name ?? "Unknown" : null);

    const events = txns.map((t) => ({
      action: t.action,
      fromName: nameOf(t.fromId),
      toName: nameOf(t.toId),
      credits: t.credits ?? null,
      anchorTxHash: t.anchorTxHash ?? null,
      at: t.timestamp,
    }));

    return ok({
      serial: rec.serial,
      energyMwh: rec.energyMwh,
      status: rec.status,
      issueTxHash: rec.issueTxHash ?? null,
      contentHash: rec.contentHash ?? null,
      events,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
