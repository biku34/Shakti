/**
 * Statistical anomaly detection (§9.2 R-09) — an unsupervised robust outlier
 * test that flags a meter reading whose reported generation deviates from that
 * meter's *own learned baseline*, rather than a fixed physical threshold (R-03).
 *
 * Method: the modified z-score of Iglewicz & Hoaglin (1993), built on the median
 * and the Median Absolute Deviation (MAD):
 *
 *     z_i = 0.6745 · (x_i − median) / MAD
 *
 * The 0.6745 constant rescales the MAD to a standard-deviation-equivalent for a
 * normal distribution; |z| > 3.5 is the authors' recommended outlier cutoff.
 * MAD is used instead of the mean/standard-deviation because it is robust: a few
 * fraudulent over-reports won't inflate the baseline and mask themselves. When
 * MAD collapses to 0 (a near-constant baseline) we fall back to the mean absolute
 * deviation with the matching 1.253314 constant, as the same authors prescribe.
 *
 * The baseline is conditioned on hour-of-day so the diurnal solar curve is not
 * itself read as variance — a noon reading is compared only against other
 * midday readings from the same meter. Only the fraud-relevant tail (generation
 * *above* baseline) raises an alert; low readings (cloud cover, faults) do not.
 */
import { connectDB } from "@/lib/db";
import { MeterReadingModel } from "@/models/MeterReading";
import type { Finding } from "./detector";

/** Iglewicz–Hoaglin recommended cutoff for the modified z-score. */
const MODIFIED_Z_THRESHOLD = 3.5;
/** Escalate to `high` severity past this magnitude (~2× the cutoff). */
const HIGH_SEVERITY_Z = 7;
/** Minimum baseline sample size before the test is trusted. */
const MIN_SAMPLES = 12;
/** Hours either side of the reading's hour-of-day to include in the baseline. */
const HOUR_WINDOW = 1;
/** Upper bound on how many recent readings we scan to build a baseline. */
const BASELINE_SCAN_LIMIT = 1000;

const MAD_TO_SIGMA = 0.6745; // Φ⁻¹(0.75), MAD → σ for a normal distribution
const MEANAD_TO_SIGMA = 1.253314; // √(π/2), mean-abs-dev → σ fallback

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Circular distance between two hours-of-day (0..23), max 12. */
function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

export interface ModifiedZResult {
  z: number; // signed modified z-score of `value`
  median: number;
  mad: number;
  sampleSize: number;
  method: "mad" | "meanad"; // which dispersion estimator was used
}

/**
 * Pure, side-effect-free modified z-score of `value` against `baseline`.
 * Returns `null` when the baseline is too small or has no dispersion to
 * distinguish an outlier (both MAD and mean-abs-dev are 0).
 */
export function modifiedZScore(value: number, baseline: number[]): ModifiedZResult | null {
  if (baseline.length < MIN_SAMPLES) return null;

  const sorted = [...baseline].sort((a, b) => a - b);
  const med = median(sorted);
  const absDev = baseline.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  const mad = median(absDev);

  if (mad > 0) {
    return {
      z: (MAD_TO_SIGMA * (value - med)) / mad,
      median: med,
      mad,
      sampleSize: baseline.length,
      method: "mad",
    };
  }

  // Degenerate MAD: fall back to the mean absolute deviation about the median.
  const meanAbsDev = baseline.reduce((s, x) => s + Math.abs(x - med), 0) / baseline.length;
  if (meanAbsDev > 0) {
    return {
      z: (value - med) / (MEANAD_TO_SIGMA * meanAbsDev),
      median: med,
      mad,
      sampleSize: baseline.length,
      method: "meanad",
    };
  }

  return null; // no dispersion — baseline is constant, can't judge an outlier
}

/**
 * DB-driven detector: builds the hour-of-day baseline for the reading's meter
 * from its prior readings and returns a single `statistical_anomaly` finding
 * when the reported generation is a high positive outlier (R-09). Never throws.
 */
export async function detectStatisticalAnomaly(readingId: string): Promise<Finding[]> {
  await connectDB();
  const reading = await MeterReadingModel.findById(readingId);
  if (!reading) return [];

  const hour = new Date(reading.timestamp).getUTCHours();

  // Prior readings for this meter, most recent first (bounded scan).
  const history = await MeterReadingModel.find({
    meterId: reading.meterId,
    timestamp: { $lt: reading.timestamp },
  })
    .sort({ timestamp: -1 })
    .limit(BASELINE_SCAN_LIMIT)
    .select({ generationKwh: 1, timestamp: 1 })
    .lean();

  // Condition the baseline on hour-of-day (diurnal-aware).
  const baseline = history
    .filter((r) => hourDistance(new Date(r.timestamp).getUTCHours(), hour) <= HOUR_WINDOW)
    .map((r) => r.generationKwh);

  const result = modifiedZScore(reading.generationKwh, baseline);
  if (!result) return [];

  // Only the over-reporting tail is fraud-relevant; ignore low outliers.
  if (result.z <= MODIFIED_Z_THRESHOLD) return [];

  const severity = result.z >= HIGH_SEVERITY_Z ? "high" : "medium";

  return [
    {
      type: "statistical_anomaly",
      severity,
      subjectType: "meter",
      subjectId: reading.meterId,
      ruleId: "R-09",
      evidence: {
        zScore: Number(result.z.toFixed(2)),
        generationKwh: Number(reading.generationKwh.toFixed(3)),
        baselineMedian: Number(result.median.toFixed(3)),
        threshold: MODIFIED_Z_THRESHOLD,
        sampleSize: result.sampleSize,
        method: result.method,
        readingIds: [readingId],
      },
    },
  ];
}
