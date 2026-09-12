// Single source of truth for feeder congestion classification.
//
// A feeder's congestion is the total live load (kW aggregated from every meter
// on the feeder) expressed as a percentage of the feeder's rated capacity:
//   < 70%      → low       ("low congested")
//   70% – 90%  → risky
//   90% – 100% → high
//   > 100%     → critical

export const CONGESTION_LEVELS = ["low", "risky", "high", "critical"] as const;
export type CongestionLevel = (typeof CONGESTION_LEVELS)[number];

/** Load as a percentage of capacity (guards against zero/negative capacity). */
export function utilisationPct(loadKw: number, capacityKw: number): number {
  return (loadKw / Math.max(capacityKw, 1)) * 100;
}

/** Classify a feeder from its live load and rated capacity. */
export function classifyCongestion(loadKw: number, capacityKw: number): CongestionLevel {
  const pct = utilisationPct(loadKw, capacityKw);
  if (pct > 100) return "critical";
  if (pct >= 90) return "high";
  if (pct >= 70) return "risky";
  return "low";
}

/** Human-readable label for a congestion level. */
export const CONGESTION_LABEL: Record<CongestionLevel, string> = {
  low: "low",
  risky: "risky",
  high: "high",
  critical: "critical",
};
