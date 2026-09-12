import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { unlistRec } from "@/services/rec/recService";
import { audit } from "@/services/audit";

// Withdraw a REC from the secondary market (holder-only, enforced in service).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole();
    const { id } = await ctx.params;
    await unlistRec(id, session.userId);
    await audit(session.userId, "rec.unlist", { type: "rec", id });
    return ok({ unlisted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
