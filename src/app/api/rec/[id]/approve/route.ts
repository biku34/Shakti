import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { approveIssuance } from "@/services/rec/recService";
import { audit } from "@/services/audit";

// FR-6.2 / FR-6.3: approve → issue + anchor on-chain.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("certificate_body");
    const { id } = await ctx.params;
    const result = await approveIssuance(id);
    await audit(session.userId, "rec.approve", { type: "rec", id }, result);
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
