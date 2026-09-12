import { z } from "zod";
import { connectDB } from "@/lib/db";
import { ok, fail, parseBody, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { MeterModel } from "@/models/Meter";
import { MeterReadingModel } from "@/models/MeterReading";
import { EnergyOfferModel } from "@/models/EnergyOffer";
import { FeederModel } from "@/models/Feeder";
import { isTradingSuspended, priceBounds } from "@/services/trading/controls";
import { audit } from "@/services/audit";

const schema = z.object({
  quantityKwh: z.number().positive(),
  askPricePerKwh: z.number().positive(),
  expiresInMinutes: z.number().positive().max(1440).default(120),
});

// FR-3.1 / FR-3.2: a prosumer sells only against verified, un-committed export.
export async function POST(req: Request) {
  try {
    const session = await requireRole("prosumer");
    if (!session.feederId) return fail(400, "Prosumer is not bound to a feeder");
    await connectDB();
    const body = await parseBody(req, schema);

    // Regulator market controls: no selling while trading is suspended, and the
    // ask must sit inside the feeder's regulated price band.
    const feeder = await FeederModel.findById(session.feederId);
    if (isTradingSuspended(feeder)) return fail(403, "Trading is suspended on this feeder by the regulator");
    const { floor, ceiling } = priceBounds(feeder);
    if (body.askPricePerKwh < floor || body.askPricePerKwh > ceiling) {
      return fail(400, `Ask must be within the regulated band ${floor}–${ceiling} cr/kWh`);
    }

    const meters = await MeterModel.find({ ownerId: session.userId });
    const meterIds = meters.map((m) => m._id);

    // Find verified readings with un-committed export, oldest first (FIFO).
    const readings = await MeterReadingModel.find({
      meterId: { $in: meterIds },
      verified: true,
      $expr: { $gt: ["$exportKwh", { $add: ["$committedExportKwh", "$recBackedKwh"] }] },
    }).sort({ timestamp: 1 });

    const available = readings.reduce(
      (s, r) => s + (r.exportKwh - r.committedExportKwh - r.recBackedKwh),
      0,
    );
    if (body.quantityKwh > available + 1e-6) {
      return fail(400, `Insufficient surplus: requested ${body.quantityKwh} kWh, available ${available.toFixed(3)} kWh`);
    }

    // Reserve export across readings greedily (FR-3.2: no double-selling).
    let toReserve = body.quantityKwh;
    const sourceReadingIds: unknown[] = [];
    for (const r of readings) {
      if (toReserve <= 1e-6) break;
      const free = r.exportKwh - r.committedExportKwh - r.recBackedKwh;
      const take = Math.min(free, toReserve);
      r.committedExportKwh = Number((r.committedExportKwh + take).toFixed(4));
      await r.save();
      sourceReadingIds.push(r._id);
      toReserve -= take;
    }

    const offer = await EnergyOfferModel.create({
      prosumerId: session.userId,
      feederId: session.feederId,
      quantityKwh: body.quantityKwh,
      remainingKwh: body.quantityKwh,
      askPricePerKwh: body.askPricePerKwh,
      sourceReadingIds,
      expiresAt: new Date(Date.now() + body.expiresInMinutes * 60 * 1000),
    });

    await audit(session.userId, "offer.create", { type: "offer", id: String(offer._id) });
    return ok(offer);
  } catch (err) {
    return errorResponse(err);
  }
}
