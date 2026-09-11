import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { computeAndSnapshotPrice } from "@/services/trading/pricing";

// FR-4.1: current clearing price for a feeder (any authenticated role).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(); // any authenticated user
    const { id: feederId } = await ctx.params;
    const pricing = await computeAndSnapshotPrice(feederId);
    return ok(pricing);
  } catch (err) {
    return errorResponse(err);
  }
}
