import { z } from "zod";
import { ok, parseBody, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { transferRec } from "@/services/rec/recService";
import { audit } from "@/services/audit";

const schema = z.object({ toUserId: z.string() });

// FR-6.4: transfer a REC to a new holder (caller must be the current holder).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    // Any role can hold/transfer; ownership is enforced in the service.
    const session = await requireRole();
    const { id } = await ctx.params;
    const { toUserId } = await parseBody(req, schema);
    await transferRec(id, session.userId, toUserId);
    await audit(session.userId, "rec.transfer", { type: "rec", id }, { toUserId });
    return ok({ transferred: true });
  } catch (err) {
    return errorResponse(err);
  }
}
