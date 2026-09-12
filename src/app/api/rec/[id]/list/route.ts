import { z } from "zod";
import { ok, parseBody, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { listRecForSale } from "@/services/rec/recService";
import { audit } from "@/services/audit";

const schema = z.object({ askCreditsPerKwh: z.number().positive() });

// List a held REC on the secondary market at a credits price (holder-only,
// enforced in the service). Credits are the only currency in the system.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole();
    const { id } = await ctx.params;
    const { askCreditsPerKwh } = await parseBody(req, schema);
    const result = await listRecForSale(id, session.userId, askCreditsPerKwh);
    await audit(session.userId, "rec.list", { type: "rec", id }, result);
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
