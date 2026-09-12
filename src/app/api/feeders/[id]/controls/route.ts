import { z } from "zod";
import { connectDB } from "@/lib/db";
import { ok, fail, parseBody, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { FeederModel } from "@/models/Feeder";
import { audit } from "@/services/audit";

const schema = z.object({
  // null clears an override (back to platform default); omitted leaves it as-is.
  priceFloorPerKwh: z.number().positive().nullable().optional(),
  priceCeilingPerKwh: z.number().positive().nullable().optional(),
  // > 0 suspends trading for that many minutes; 0 resumes immediately.
  suspendMinutes: z.number().min(0).max(1440).optional(),
});

// Regulator sets a feeder's price band and/or suspends trading (FR-10.x).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("regulator");
    const { id } = await ctx.params;
    const body = await parseBody(req, schema);
    await connectDB();

    const feeder = await FeederModel.findById(id);
    if (!feeder) return fail(404, "Feeder not found");

    if (body.priceFloorPerKwh !== undefined) feeder.priceFloorPerKwh = body.priceFloorPerKwh;
    if (body.priceCeilingPerKwh !== undefined) feeder.priceCeilingPerKwh = body.priceCeilingPerKwh;

    const floor = feeder.priceFloorPerKwh;
    const ceiling = feeder.priceCeilingPerKwh;
    if (floor != null && ceiling != null && floor > ceiling) {
      return fail(400, "Lower cap cannot exceed higher cap");
    }

    if (body.suspendMinutes !== undefined) {
      feeder.tradingSuspendedUntil =
        body.suspendMinutes > 0 ? new Date(Date.now() + body.suspendMinutes * 60 * 1000) : null;
    }

    await feeder.save();
    await audit(session.userId, "feeder.controls", { type: "feeder", id }, {
      priceFloorPerKwh: feeder.priceFloorPerKwh,
      priceCeilingPerKwh: feeder.priceCeilingPerKwh,
      tradingSuspendedUntil: feeder.tradingSuspendedUntil,
    });

    return ok({
      priceFloorPerKwh: feeder.priceFloorPerKwh ?? null,
      priceCeilingPerKwh: feeder.priceCeilingPerKwh ?? null,
      tradingSuspendedUntil: feeder.tradingSuspendedUntil ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
