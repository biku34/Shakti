import { z } from "zod";
import { connectDB } from "@/lib/db";
import { ok, fail, parseBody, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { TradeModel } from "@/models/Trade";
import { audit } from "@/services/audit";

const schema = z.object({
  flagged: z.boolean(),
  reason: z.string().max(300).optional(),
});

// Regulator flags (or clears) a compliance hold on an already-settled trade.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("regulator");
    const { id } = await ctx.params;
    const body = await parseBody(req, schema);
    await connectDB();

    const trade = await TradeModel.findById(id);
    if (!trade) return fail(404, "Trade not found");

    trade.flagged = body.flagged;
    trade.flagReason = body.flagged ? (body.reason ?? "Flagged for regulatory review") : null;
    trade.flaggedAt = body.flagged ? new Date() : null;
    await trade.save();

    await audit(session.userId, body.flagged ? "trade.flag" : "trade.unflag", { type: "trade", id });
    return ok({ flagged: trade.flagged });
  } catch (err) {
    return errorResponse(err);
  }
}
