import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { RecCertificateModel } from "@/models/RecCertificate";
import { UserModel } from "@/models/User";
import { FeederModel } from "@/models/Feeder";

// Secondary-market order book: every REC currently listed for sale, enriched with
// party names + feeder for the buyer's marketplace. `isOwn` flags the caller's
// own listings (which they can't buy). Any authenticated user may browse.
export async function GET() {
  try {
    const session = await requireRole();
    await connectDB();

    const recs = await RecCertificateModel.find({ listed: true, status: { $in: ["issued", "transferred"] } })
      .sort({ listedAt: -1 })
      .limit(200)
      .lean();

    const userIds = [...new Set(recs.flatMap((r) => [String(r.generatorId), String(r.currentHolderId)]))];
    const feederIds = [...new Set(recs.map((r) => String(r.feederId)))];
    const [users, feeders] = await Promise.all([
      UserModel.find({ _id: { $in: userIds } }).select("name").lean(),
      FeederModel.find({ _id: { $in: feederIds } }).select("code").lean(),
    ]);
    const nameById = new Map(users.map((u) => [String(u._id), (u as { name?: string }).name ?? "?"]));
    const feederById = new Map(feeders.map((f) => [String(f._id), (f as { code?: string }).code ?? "?"]));

    const items = recs.map((r) => {
      const ask = r.askCreditsPerKwh ?? 0;
      return {
        _id: String(r._id),
        serial: r.serial,
        energyMwh: r.energyMwh,
        askCreditsPerKwh: ask,
        totalCredits: Number((r.energyMwh * 1000 * ask).toFixed(4)),
        generationWindow: r.generationWindow,
        feederCode: feederById.get(String(r.feederId)) ?? "?",
        generatorName: nameById.get(String(r.generatorId)) ?? "?",
        holderName: nameById.get(String(r.currentHolderId)) ?? "?",
        status: r.status,
        issueTxHash: r.issueTxHash ?? null,
        listedAt: r.listedAt,
        isOwn: String(r.currentHolderId) === session.userId,
      };
    });

    return ok(items);
  } catch (err) {
    return errorResponse(err);
  }
}
