// Regulator market controls applied to a feeder: a price band (floor/ceiling)
// and a temporary trading suspension. Pure helpers shared by the offer/bid
// routes, the matching engine and the pricing engine.

import { env } from "@/lib/env";

type FeederControls = {
  priceFloorPerKwh?: number | null;
  priceCeilingPerKwh?: number | null;
  tradingSuspendedUntil?: Date | string | null;
};

/** True while the regulator's suspension window is still in effect. */
export function isTradingSuspended(feeder: FeederControls | null | undefined): boolean {
  const until = feeder?.tradingSuspendedUntil;
  return !!until && new Date(until).getTime() > Date.now();
}

/** Milliseconds until trading resumes (0 if not suspended). */
export function suspensionRemainingMs(feeder: FeederControls | null | undefined): number {
  const until = feeder?.tradingSuspendedUntil;
  if (!until) return 0;
  return Math.max(0, new Date(until).getTime() - Date.now());
}

/** Effective price band for a feeder — regulator overrides, else env defaults. */
export function priceBounds(feeder: FeederControls | null | undefined): { floor: number; ceiling: number } {
  return {
    floor: feeder?.priceFloorPerKwh ?? env.pricing.fitFloor(),
    ceiling: feeder?.priceCeilingPerKwh ?? env.pricing.retailCeiling(),
  };
}
