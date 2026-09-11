/**
 * Shared meter-reading ingestion core (§7.3).
 *
 * Stores a batch of bidirectional readings, runs physical-plausibility checks
 * (FR-2.2/2.3), refreshes meter freshness (FR-2.4), recomputes feeder load &
 * congestion (FR-2.5), and fires reading-level fraud rules (FR-7.1).
 *
 * Used by both the HTTP ingestion endpoint (real/simulated hardware over the
 * wire) and the in-process Node simulator engine (no self-HTTP hop needed).
 */
import { connectDB } from "@/lib/db";
import { MeterModel } from "@/models/Meter";
import { FeederModel } from "@/models/Feeder";
import { MeterReadingModel } from "@/models/MeterReading";
import { detectOnReading } from "@/services/fraud/detector";
import { classifyCongestion } from "@/lib/congestion";

const MAX_IRRADIANCE = 1.0;

export type IngestReading = {
  meterId: string; // meter CODE, e.g. "GNR-M-00042"
  feederId: string; // feeder CODE, e.g. "GNR-F-011"
  timestamp: string;
  intervalMinutes: number;
  generationKwh: number;
  consumptionKwh: number;
  importKwh: number;
  exportKwh: number;
  irradianceFactor: number;
  meterStatus: "online" | "offline";
};

export type IngestResult = {
  received: number;
  stored: number;
  alertsRaised: number;
  results: { meterId: string; stored: boolean; verified: boolean; reason?: string }[];
};

/** Persist a batch of readings and run all downstream processing. */
export async function ingestBatch(batch: IngestReading[]): Promise<IngestResult> {
  await connectDB();

  const results: IngestResult["results"] = [];
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

  return { received: batch.length, stored: createdReadingIds.length, alertsRaised, results };
}

async function recomputeFeederLoad(feederId: string): Promise<void> {
  const feeder = await FeederModel.findById(feederId);
  if (!feeder) return;

  // Feeder load = Σ solar output (kW) over the most recent reading per meter.
  const recent = await MeterReadingModel.aggregate([
    { $match: { feederId: feeder._id } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: "$meterId", generationKwh: { $first: "$generationKwh" }, interval: { $first: "$intervalMinutes" } } },
  ]);

  let genKw = 0;
  for (const row of recent) {
    const hours = (row.interval ?? 15) / 60;
    genKw += row.generationKwh / hours;
  }
  const loadKw = Math.max(0, genKw);
  feeder.currentLoadKw = Number(loadKw.toFixed(2));
  feeder.congestionLevel = classifyCongestion(loadKw, feeder.capacityKw);
  await feeder.save();
}
