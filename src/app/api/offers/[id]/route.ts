import { connectDB } from "@/lib/db";
import { ok, fail, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { EnergyOfferModel } from "@/models/EnergyOffer";
import { MeterReadingModel } from "@/models/MeterReading";
import { audit } from "@/services/audit";

// FR-3.5: cancel an offer while open|partial; release its reserved export.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("prosumer");
    await connectDB();
    const { id } = await ctx.params;

    const offer = await EnergyOfferModel.findById(id);
    if (!offer) return fail(404, "Offer not found");
    if (String(offer.prosumerId) !== session.userId) return fail(403, "Not your offer");
    if (!["open", "partial"].includes(offer.status)) {
      return fail(409, `Cannot cancel offer in status ${offer.status}`);
    }

    // Release the still-unsold reserved export back to its readings.
    const releaseKwh = offer.remainingKwh;
    let toRelease = releaseKwh;
    const readings = await MeterReadingModel.find({ _id: { $in: offer.sourceReadingIds } });
    for (const r of readings) {
      if (toRelease <= 1e-6) break;
      const give = Math.min(r.committedExportKwh, toRelease);
      r.committedExportKwh = Number((r.committedExportKwh - give).toFixed(4));
      await r.save();
      toRelease -= give;
    }

    offer.status = "cancelled";
    await offer.save();
    await audit(session.userId, "offer.cancel", { type: "offer", id });
    return ok({ cancelled: true, releasedKwh: releaseKwh });
  } catch (err) {
    return errorResponse(err);
  }
}
