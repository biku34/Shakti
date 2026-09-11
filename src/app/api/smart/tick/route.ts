import { ok, errorResponse } from "@/lib/api";
import { getEngine } from "@/services/simulator/engine";

// Push one batch immediately for the running meters (manual step).
export async function POST() {
  try {
    const result = await getEngine().tick();
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
