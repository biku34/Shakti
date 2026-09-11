import { ok, errorResponse } from "@/lib/api";
import { getEngine } from "@/services/simulator/engine";

// Current sim clock, per-meter type/running/fault state (SM-*).
export async function GET() {
  try {
    return ok(getEngine().state());
  } catch (err) {
    return errorResponse(err);
  }
}
