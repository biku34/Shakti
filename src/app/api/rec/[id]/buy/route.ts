import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { purchaseRec } from "@/services/rec/recService";
import { audit } from "@/services/audit";

// Buy a listed REC: credits move buyer→seller, ownership transfers, the sale is
// anchored on-chain. Any authenticated user can be a buyer; the service enforces
// listing state, funds, and no self-purchase.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole();
    const { id } = await ctx.params;
    const result = await purchaseRec(id, session.userId);
    await audit(session.userId, "rec.purchase", { type: "rec", id }, {
      totalCredits: result.totalCredits,
      txHash: result.txHash,
    });
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
