import { z } from "zod";
import { connectDB } from "@/lib/db";
import { ok, parseBody, errorResponse, requireServiceToken } from "@/lib/api";
import { MeterModel } from "@/models/Meter";
import { FeederModel } from "@/models/Feeder";
import { MeterReadingModel } from "@/models/MeterReading";
import { detectOnReading } from "@/services/fraud/detector";

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

const MAX_IRRADIANCE = 1.0;

export async function POST(req: Request) {
  try {
    requireServiceToken(req); // SEC-4 / CI-3
    await connectDB();
    const { batch } = await parseBody(req, schema);

    const results: { meterId: string; stored: boolean; verified: boolean; reason?: string }[] = [];
    const touchedFeeders = new Set<string>();
    const createdReadingIds: string[] = [];

    for (const r of batch) {
      const meter = await MeterModel.findOne({ code: r.meterId });
      const feeder = await FeederModel.findOne({ code: r.feederId });
      if (!meter || !feeder) {
        results.push({ meterId: r.meterId, stored: false, verified: false, reason: "unknown meter/feeder" });
        continue;
      }

      // FR-2.2 / FR-2.3: physical plausibility.
      const hours = r.intervalMinutes / 60;
      const maxPossible = meter.solarCapacityKw * hours * MAX_IRRADIANCE;
      const plausible = r.generationKwh <= maxPossible + 1e-6;
      const consistent =
        Math.abs(r.exportKwh - Math.max(0, r.generationKwh - r.consumptionKwh)) < 0.05 + 1e-6 ||
        r.meterStatus === "offline";
      const verified = plausible && consistent && r.meterStatus === "online";

      const reading = await MeterReadingModel.create({
        meterId: meter._id,
        feederId: feeder._id,
        timestamp: new Date(r.timestamp),
        intervalMinutes: r.intervalMinutes,
        generationKwh: r.generationKwh,
        consumptionKwh: r.consumptionKwh,
        importKwh: r.importKwh,
        exportKwh: r.exportKwh,
        irradianceFactor: r.irradianceFactor,
        meterStatus: r.meterStatus,
        verified,
      });
      createdReadingIds.push(String(reading._id));

      // FR-2.4: update meter freshness/status.
      meter.lastReadingAt = new Date(r.timestamp);
      meter.status = r.meterStatus;
      await meter.save();

      touchedFeeders.add(String(feeder._id));
      results.push({ meterId: r.meterId, stored: true, verified });
    }

    // FR-2.5: recompute feeder load & congestion from the latest reading per meter.
    for (const feederId of touchedFeeders) {
      await recomputeFeederLoad(feederId);
    }

    // FR-7.1: run reading-level fraud rules on ingestion.
    let alertsRaised = 0;
    for (const id of createdReadingIds) {
      alertsRaised += await detectOnReading(id);
    }

    return ok({ received: batch.length, stored: createdReadingIds.length, alertsRaised, results });
  } catch (err) {
    return errorResponse(err);
  }
}

async function recomputeFeederLoad(feederId: string): Promise<void> {
  const feeder = await FeederModel.findById(feederId);
  if (!feeder) return;

  // Net grid load = Σ(import − export) over the most recent reading per meter.
  const recent = await MeterReadingModel.aggregate([
    { $match: { feederId: feeder._id } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: "$meterId", importKwh: { $first: "$importKwh" }, exportKwh: { $first: "$exportKwh" }, interval: { $first: "$intervalMinutes" } } },
  ]);

  let netKw = 0;
  for (const row of recent) {
    const hours = (row.interval ?? 15) / 60;
    netKw += (row.importKwh - row.exportKwh) / hours;
  }
  const loadKw = Math.max(0, netKw);
  const ratio = loadKw / Math.max(feeder.capacityKw, 1);
  feeder.currentLoadKw = Number(loadKw.toFixed(2));
  feeder.congestionLevel = ratio > 0.8 ? "high" : ratio > 0.5 ? "medium" : "low";
  await feeder.save();
}
