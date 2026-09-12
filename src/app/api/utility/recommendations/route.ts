import { ok, fail, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { recommendFeederActions, type FeederSnapshot } from "@/services/ai/recommendations";

// FR-9: top-3 priority feeder actions from the current congestion picture.
// The client posts the live monitor snapshot (which includes transfer-demo zones
// held in client state), so the advice reflects exactly what the operator sees.
export async function POST(req: Request) {
  try {
    await requireRole("utility", "regulator");
    const body = (await req.json().catch(() => null)) as { feeders?: FeederSnapshot[] } | null;
    const feeders = Array.isArray(body?.feeders) ? body!.feeders : null;
    if (!feeders) return fail(400, "Body must include a `feeders` array");

    const result = await recommendFeederActions(feeders.slice(0, 40));
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
