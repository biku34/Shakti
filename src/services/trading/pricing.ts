/**
 * Dynamic pricing (§6.4, §9.1) behind a swappable interface (AG-1..AG-3).
 * The rule-based strategy is the default; a `GroqPricingAgent` can be
 * registered later via `setPricingStrategy` with no change to callers or UI.
 */
import { connectDB } from "@/lib/db";
import { env } from "@/lib/env";
import { EnergyOfferModel } from "@/models/EnergyOffer";
import { EnergyBidModel } from "@/models/EnergyBid";
import { FeederModel } from "@/models/Feeder";
import { PricingSnapshotModel } from "@/models/PricingSnapshot";
import type { CongestionLevel } from "@/lib/congestion";

export type { CongestionLevel };

export type PricingInput = {
  feederId: string;
  supplyKwh: number;
  demandKwh: number;
  congestionLevel: CongestionLevel;
};

export type PricingOutput = {
  clearingPrice: number;
  fitFloor: number;
  retailCeiling: number;
  supplyKwh: number;
  demandKwh: number;
  congestionLevel: CongestionLevel;
};

export interface IPricingStrategy {
  price(input: PricingInput): PricingOutput;
}

const CONGESTION_FACTOR: Record<CongestionLevel, number> = {
  low: 0.0,
  risky: 0.15,
  high: 0.3,
  critical: 0.45,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Rule-based strategy implementing the §9.1 formula. */
export class RulePricingStrategy implements IPricingStrategy {
  price(input: PricingInput): PricingOutput {
    const base = env.pricing.base();
    const alpha = env.pricing.alpha();
    const beta = env.pricing.beta();
    const fitFloor = env.pricing.fitFloor();
    const retailCeiling = env.pricing.retailCeiling();

    const eps = 1e-6;
    const ratio = input.demandKwh / Math.max(input.supplyKwh, eps);
    const congestion = CONGESTION_FACTOR[input.congestionLevel];

    const raw = base * (1 + alpha * (ratio - 1) + beta * congestion);
    // FR-4.2: never below FiT floor nor above retail ceiling.
    const clearingPrice = Number(clamp(raw, fitFloor, retailCeiling).toFixed(4));

    return {
      clearingPrice,
      fitFloor,
      retailCeiling,
      supplyKwh: input.supplyKwh,
      demandKwh: input.demandKwh,
      congestionLevel: input.congestionLevel,
    };
  }
}

let strategy: IPricingStrategy = new RulePricingStrategy();

/** Swap in an alternative strategy (e.g. GroqPricingAgent) at runtime (AG-2). */
export function setPricingStrategy(s: IPricingStrategy): void {
  strategy = s;
}

/**
 * Gather live supply/demand/congestion for a feeder, compute the clearing
 * price, and persist a pricing snapshot (FR-4.1, FR-4.4).
 */
export async function computeAndSnapshotPrice(feederId: string): Promise<PricingOutput> {
  await connectDB();

  const [offers, bids, feeder] = await Promise.all([
    EnergyOfferModel.find({ feederId, status: { $in: ["open", "partial"] } }),
    EnergyBidModel.find({ feederId, status: { $in: ["open", "partial"] } }),
    FeederModel.findById(feederId),
  ]);

  const supplyKwh = offers.reduce((s, o) => s + o.remainingKwh, 0);
  const demandKwh = bids.reduce((s, b) => s + b.remainingKwh, 0);
  const congestionLevel = (feeder?.congestionLevel as CongestionLevel) ?? "low";

  const output = strategy.price({ feederId, supplyKwh, demandKwh, congestionLevel });

  // Re-clamp to the feeder's regulated band if the regulator set overrides.
  const floor = feeder?.priceFloorPerKwh ?? output.fitFloor;
  const ceiling = feeder?.priceCeilingPerKwh ?? output.retailCeiling;
  output.fitFloor = floor;
  output.retailCeiling = ceiling;
  output.clearingPrice = Number(Math.min(ceiling, Math.max(floor, output.clearingPrice)).toFixed(4));

  await PricingSnapshotModel.create({
    feederId,
    supplyKwh,
    demandKwh,
    congestionLevel,
    clearingPrice: output.clearingPrice,
    fitFloor: output.fitFloor,
    retailCeiling: output.retailCeiling,
  });

  return output;
}
