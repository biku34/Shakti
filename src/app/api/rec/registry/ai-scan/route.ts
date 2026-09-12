import { z } from "zod";
import { ok, parseBody, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { reviewRegistry } from "@/services/fraud/recAiFlag";
import { audit } from "@/services/audit";

const schema = z.object({ all: z.boolean().optional(), limit: z.number().int().positive().optional() }).partial();

// Sweep the REC registry with the LLM anomaly check. Default: only RECs not yet
// checked (cheap, incremental). `all: true` re-checks the whole live registry.
export async function POST(req: Request) {
  try {
    const session = await requireRole("certificate_body", "regulator");
    const body = await parseBody(req, schema).catch(() => ({}) as { all?: boolean; limit?: number });
    const result = await reviewRegistry(body);
    await audit(session.userId, "rec.registry_ai_scan", undefined, result);
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
