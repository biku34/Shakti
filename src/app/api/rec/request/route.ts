import { z } from "zod";
import { ok, parseBody, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { requestIssuance } from "@/services/rec/recService";
import { audit } from "@/services/audit";

const schema = z.object({
  meterCode: z.string(),
  energyMwh: z.number().positive().default(0.001), // demo-scale (1 kWh) by default
});

// Prosumer requests a REC against verified generation → creates a pending REC
// for the certificate body's issuance queue (feeds FR-6.2).
export async function POST(req: Request) {
  try {
    const session = await requireRole("prosumer");
    const body = await parseBody(req, schema);
    const result = await requestIssuance({
      generatorId: session.userId,
      meterCode: body.meterCode,
      energyMwh: body.energyMwh,
    });
    await audit(session.userId, "rec.request", { type: "rec", id: result.recId });
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
