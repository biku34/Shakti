import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { cancelRequest } from "@/services/rec/recService";
import { audit } from "@/services/audit";

// Cancel a pending REC request (generator only, before issuance). Releases the
// surplus that was held at request time.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("prosumer");
    const { id } = await ctx.params;
    const result = await cancelRequest(id, session.userId);
    await audit(session.userId, "rec.cancel", { type: "rec", id }, result);
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
