import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { retireRec } from "@/services/rec/recService";
import { audit } from "@/services/audit";

// FR-6.4 / FR-6.5: retire a REC (permanent, non-reusable).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole();
    const { id } = await ctx.params;
    await retireRec(id, session.userId);
    await audit(session.userId, "rec.retire", { type: "rec", id });
    return ok({ retired: true });
  } catch (err) {
    return errorResponse(err);
  }
}
