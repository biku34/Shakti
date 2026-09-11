/**
 * Anomaly detection (§6.7, §9.2) behind a swappable interface (AG-1..AG-3).
 * `RuleAnomalyDetector` implements rules R-01..R-08; a `GroqAgenticDetector`
 * can be registered later via `setAnomalyDetector` with identical I/O (FR-7.8).
 */
import { connectDB } from "@/lib/db";
import { MeterModel } from "@/models/Meter";
import { MeterReadingModel } from "@/models/MeterReading";
import { RecCertificateModel } from "@/models/RecCertificate";
import { FraudAlertModel, type FraudAlert } from "@/models/FraudAlert";

export type Finding = Pick<
  FraudAlert,
  "type" | "severity" | "subjectType" | "subjectId" | "ruleId" | "evidence"
>;

export interface IAnomalyDetector {
  /** Rules that apply to a single meter reading on ingestion (R-03..R-05). */
  scanReading(readingId: string): Promise<Finding[]>;
  /** Rules that apply to a REC on/after issuance (R-01, R-02, R-06, R-08). */
  scanRec(recId: string): Promise<Finding[]>;
}

// Physical constants for plausibility (§9.2 R-03).
const MAX_IRRADIANCE = 1.0;
const NIGHT_START_HOUR = 19; // 19:00
const NIGHT_END_HOUR = 5; // 05:00

export class RuleAnomalyDetector implements IAnomalyDetector {
  async scanReading(readingId: string): Promise<Finding[]> {
    await connectDB();
    const reading = await MeterReadingModel.findById(readingId);
    if (!reading) return [];
    const findings: Finding[] = [];

    // R-04: generation reported while meter offline.
    if (reading.meterStatus === "offline" && reading.generationKwh > 0) {
      findings.push({
        type: "offline_generation",
        severity: "high",
        subjectType: "meter",
        subjectId: reading.meterId,
        ruleId: "R-04",
        evidence: { generationKwh: reading.generationKwh, readingIds: [readingId] },
      });
    }

    // R-05: non-zero generation during night hours.
    const hourUtc = new Date(reading.timestamp).getUTCHours();
    const isNight = hourUtc >= NIGHT_START_HOUR || hourUtc < NIGHT_END_HOUR;
    if (isNight && reading.generationKwh > 0) {
      findings.push({
        type: "night_generation",
        severity: "medium",
        subjectType: "meter",
        subjectId: reading.meterId,
        ruleId: "R-05",
        evidence: { hourUtc, generationKwh: reading.generationKwh, readingIds: [readingId] },
      });
    }

    // R-03: generation exceeds physical capacity for the interval.
    const meter = await MeterModel.findById(reading.meterId);
    if (meter) {
      const hours = (reading.intervalMinutes ?? 15) / 60;
      const maxPossible = meter.solarCapacityKw * hours * MAX_IRRADIANCE;
      if (reading.generationKwh > maxPossible + 1e-6) {
        findings.push({
          type: "over_claim",
          severity: "high",
          subjectType: "meter",
          subjectId: reading.meterId,
          ruleId: "R-03",
          evidence: {
            claimed: reading.generationKwh,
            maxPossible: Number(maxPossible.toFixed(4)),
            readingIds: [readingId],
          },
        });
      }
    }

    return findings;
  }

  async scanRec(recId: string): Promise<Finding[]> {
    await connectDB();
    const rec = await RecCertificateModel.findById(recId);
    if (!rec) return [];
    const findings: Finding[] = [];

    const readings = await MeterReadingModel.find({ _id: { $in: rec.backingReadingIds } });
    const meteredExportKwh = readings.reduce((s, r) => s + r.exportKwh, 0);
    // Authoritative backing = the kWh this REC actually reserved from each reading
    // (a reading may be partially consumed). Fall back to full export for legacy
    // records without the per-reading breakdown.
    const backedKwh =
      rec.backingReadingKwh && rec.backingReadingKwh.length > 0
        ? rec.backingReadingKwh.reduce((s, k) => s + (k ?? 0), 0)
        : meteredExportKwh;
    const claimedKwh = rec.energyMwh * 1000; // MWh → kWh

    // R-01: claimed REC energy exceeds the metered export reserved to back it.
    if (claimedKwh > backedKwh + 1e-6) {
      findings.push({
        type: "over_claim",
        severity: "high",
        subjectType: "rec",
        subjectId: rec._id,
        ruleId: "R-01",
        evidence: { claimedKwh, backedKwh, meteredExportKwh, readingIds: rec.backingReadingIds },
      });
    }

    // R-06: REC volume ≠ sum of backing metered export it reserved (tolerance 1%).
    if (Math.abs(claimedKwh - backedKwh) > 0.01 * Math.max(claimedKwh, 1)) {
      findings.push({
        type: "volume_mismatch",
        severity: "high",
        subjectType: "rec",
        subjectId: rec._id,
        ruleId: "R-06",
        evidence: { claimedKwh, backedKwh, readingIds: rec.backingReadingIds },
      });
    }

    // R-02: another REC shares backing readings (duplicate window).
    const overlapping = await RecCertificateModel.findOne({
      _id: { $ne: rec._id },
      backingReadingIds: { $in: rec.backingReadingIds },
      status: { $ne: "revoked" },
    });
    if (overlapping) {
      findings.push({
        type: "duplicate_rec",
        severity: "critical",
        subjectType: "rec",
        subjectId: rec._id,
        ruleId: "R-02",
        evidence: { conflictsWith: overlapping._id, serial: overlapping.serial },
      });
    }

    // R-08: same backing readings claimed across ≥2 feeders/meters.
    if (overlapping && String(overlapping.feederId) !== String(rec.feederId)) {
      findings.push({
        type: "cross_feeder",
        severity: "critical",
        subjectType: "rec",
        subjectId: rec._id,
        ruleId: "R-08",
        evidence: { thisFeeder: rec.feederId, otherFeeder: overlapping.feederId },
      });
    }

    // R-07: abnormally high issuance rate for this meter (velocity).
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const recentCount = await RecCertificateModel.countDocuments({
      meterId: rec.meterId,
      createdAt: { $gte: dayAgo },
    });
    if (recentCount > 10) {
      findings.push({
        type: "velocity",
        severity: "medium",
        subjectType: "meter",
        subjectId: rec.meterId,
        ruleId: "R-07",
        evidence: { recsInLast24h: recentCount },
      });
    }

    return findings;
  }
}

let detector: IAnomalyDetector = new RuleAnomalyDetector();

/** Swap in an alternative detector (e.g. GroqAgenticDetector) at runtime (AG-2). */
export function setAnomalyDetector(d: IAnomalyDetector): void {
  detector = d;
}

/** Persist findings as fraud alerts, de-duplicating open alerts on (ruleId, subject). */
export async function raiseFindings(findings: Finding[]): Promise<number> {
  await connectDB();
  let created = 0;
  for (const f of findings) {
    const existing = await FraudAlertModel.findOne({
      ruleId: f.ruleId,
      subjectId: f.subjectId,
      status: { $in: ["open", "investigating"] },
    });
    if (existing) continue;
    await FraudAlertModel.create(f);
    created++;
  }
  return created;
}

/** Convenience: scan a reading and raise any resulting alerts (FR-7.1, FR-7.2). */
export async function detectOnReading(readingId: string): Promise<number> {
  return raiseFindings(await detector.scanReading(readingId));
}

/** Convenience: scan a REC and raise any resulting alerts. */
export async function detectOnRec(recId: string): Promise<number> {
  return raiseFindings(await detector.scanRec(recId));
}

export { detector };
