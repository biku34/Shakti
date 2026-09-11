import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { revokeRec } from "@/services/rec/recService";
import { audit } from "@/services/audit";

// FR-7.7: revoke a fraudulent REC, anchored on-chain.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("regulator", "certificate_body");
    const { id } = await ctx.params;
    await revokeRec(id, session.userId);
    await audit(session.userId, "rec.revoke", { type: "rec", id });
    return ok({ revoked: true });
  } catch (err) {
    return errorResponse(err);
  }
}
