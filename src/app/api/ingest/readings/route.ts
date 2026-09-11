import { z } from "zod";
import { ok, parseBody, errorResponse, requireServiceToken } from "@/lib/api";
import { ingestBatch } from "@/services/ingest/ingestReadings";

// §7.3 ingestion contract — deliberately matches real bidirectional meter output (DC-6).
const readingSchema = z.object({
  meterId: z.string(), // meter CODE, e.g. "GNR-M-00042"
  feederId: z.string(), // feeder CODE, e.g. "GNR-F-011"
  timestamp: z.string().datetime(),
  intervalMinutes: z.number().positive().default(15),
  generationKwh: z.number().min(0),
  consumptionKwh: z.number().min(0),
  importKwh: z.number().min(0).default(0),
  exportKwh: z.number().min(0).default(0),
  irradianceFactor: z.number().min(0).max(1).default(0),
  meterStatus: z.enum(["online", "offline"]).default("online"),
});
const schema = z.object({ batch: z.array(readingSchema).min(1) });

export async function POST(req: Request) {
  try {
    requireServiceToken(req); // SEC-4 / CI-3
    const { batch } = await parseBody(req, schema);
    const result = await ingestBatch(batch);
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
