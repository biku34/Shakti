import { z } from "zod";
import { ok, fail, parseBody, errorResponse } from "@/lib/api";
import { getEngine } from "@/services/simulator/engine";

// Per-meter start/stop. Starting one meter streams data to that meter only, so
// its owner's dashboard updates in isolation. `all: true` toggles every meter.
const schema = z.object({
  meterCode: z.string().optional(),
  running: z.boolean().default(true),
  all: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const { meterCode, running, all } = await parseBody(req, schema);
    const engine = getEngine();

    if (all) {
      engine.setAllRunning(running);
      return ok({ runningCount: engine.state().runningCount });
    }
    if (!meterCode) return fail(400, "meterCode or all is required");

    const m = engine.setMeterRunning(meterCode, running);
    if (!m) return fail(404, `unknown meter ${meterCode}`);
    return ok({ meter: m.code, running: m.running });
  } catch (err) {
    return errorResponse(err);
  }
}
