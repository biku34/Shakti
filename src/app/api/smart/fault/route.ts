import { z } from "zod";
import { ok, fail, parseBody, errorResponse } from "@/lib/api";
import { getEngine } from "@/services/simulator/engine";

// Arm/clear a fault on a meter for the fraud demo (SM-6, Appendix B).
const schema = z.object({
  meterCode: z.string(),
  fault: z.enum(["inflate", "night", "offline_report", "clear"]),
});

export async function POST(req: Request) {
  try {
    const { meterCode, fault } = await parseBody(req, schema);
    const m = getEngine().setFault(meterCode, fault);
    if (!m) return fail(404, `unknown meter ${meterCode}`);
    return ok({ meter: m.code, fault: m.fault });
  } catch (err) {
    return errorResponse(err);
  }
}
