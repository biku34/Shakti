// Feeder load-transfer logic (ADMS-style network reconfiguration).
//
// A congested feeder can shed load onto an *electrically adjacent* feeder — one
// it shares a tie switch with — provided that feeder has spare headroom and the
// tie can carry the power. This models the real operation; it is NOT distance
// based. Pure and framework-free so it can be unit-tested in isolation.

import { classifyCongestion, type CongestionLevel } from "@/lib/congestion";

export type FeederNode = {
  id: string;
  code: string;
  area: string;
  capacityKw: number;
  loadKw: number;
};

// A tie switch is the only path load can move between two feeders.
export type TieSwitch = {
  a: string; // feeder id
  b: string; // feeder id
  ratedKw: number; // thermal limit of the tie link
  normallyOpen: boolean; // true for a standby tie switch
};

// Never push a receiving feeder past this utilisation…
export const SAFE_UTIL = 0.9;
// …and only relieve the source down to about this utilisation (minimal switching).
export const RELIEF_TARGET = 0.85;

// ── Hand-authored electrical adjacency for the 12 Gandhinagar demo zones ──
// Ids match the map zones (gnr-z-0 … gnr-z-11). A sparse mesh: each zone is
// tied to 1–3 geographically-plausible neighbours.
export const TIES: TieSwitch[] = [
  { a: "gnr-z-0", b: "gnr-z-1", ratedKw: 200, normallyOpen: true }, // Sector 1 ↔ Sector 7
  { a: "gnr-z-0", b: "gnr-z-4", ratedKw: 150, normallyOpen: true }, // Sector 1 ↔ Pethapur
  { a: "gnr-z-1", b: "gnr-z-2", ratedKw: 200, normallyOpen: true }, // Sector 7 ↔ Sector 16
  { a: "gnr-z-2", b: "gnr-z-3", ratedKw: 180, normallyOpen: true }, // Sector 16 ↔ Sector 24
  { a: "gnr-z-3", b: "gnr-z-5", ratedKw: 180, normallyOpen: true }, // Sector 24 ↔ Sargasan
  { a: "gnr-z-3", b: "gnr-z-6", ratedKw: 180, normallyOpen: true }, // Sector 24 ↔ Sector 30
  { a: "gnr-z-5", b: "gnr-z-6", ratedKw: 200, normallyOpen: true }, // Sargasan ↔ Sector 30
  { a: "gnr-z-6", b: "gnr-z-7", ratedKw: 180, normallyOpen: true }, // Sector 30 ↔ Infocity/DAIICT
  { a: "gnr-z-7", b: "gnr-z-9", ratedKw: 200, normallyOpen: true }, // Infocity ↔ Kudasan
  { a: "gnr-z-7", b: "gnr-z-8", ratedKw: 150, normallyOpen: true }, // Infocity ↔ Randesan
  { a: "gnr-z-8", b: "gnr-z-9", ratedKw: 150, normallyOpen: true }, // Randesan ↔ Kudasan
  { a: "gnr-z-9", b: "gnr-z-10", ratedKw: 180, normallyOpen: true }, // Kudasan ↔ Raysan
  { a: "gnr-z-10", b: "gnr-z-11", ratedKw: 150, normallyOpen: true }, // Raysan ↔ Uvarsad
];

/** Tie switches touching a feeder. */
export function neighborsOf(id: string): TieSwitch[] {
  return TIES.filter((t) => t.a === id || t.b === id);
}

/** Utilisation as a percentage. */
export function utilPct(f: FeederNode): number {
  return (f.loadKw / Math.max(f.capacityKw, 1)) * 100;
}

/** How much a receiver can still absorb before hitting SAFE_UTIL. */
export function headroomKw(f: FeederNode): number {
  return Math.max(0, f.capacityKw * SAFE_UTIL - f.loadKw);
}

/** How much an overloaded source wants to shed to reach RELIEF_TARGET. */
export function reliefNeededKw(src: FeederNode): number {
  return Math.max(0, src.loadKw - src.capacityKw * RELIEF_TARGET);
}

export type TransferOption<T extends FeederNode = FeederNode> = {
  target: T;
  tie: TieSwitch;
  transferKw: number;
  source: { before: number; after: number }; // utilisation %
  dest: { before: number; after: number }; // utilisation %
  destLevelAfter: CongestionLevel;
};

/**
 * Feasible, ranked load-transfer options for a congested source feeder.
 * A target is offered only if it is tie-adjacent, has headroom, and would not
 * itself become critical. Best relief (largest transfer) first.
 */
export function transferOptions<T extends FeederNode>(
  src: T,
  all: Map<string, T>,
): TransferOption<T>[] {
  const need = reliefNeededKw(src);
  if (need <= 0) return [];

  return neighborsOf(src.id)
    .map((tie): TransferOption<T> | null => {
      const targetId = tie.a === src.id ? tie.b : tie.a;
      const target = all.get(targetId);
      if (!target) return null;
      const transferKw = Math.round(Math.min(need, headroomKw(target), tie.ratedKw));
      return {
        target,
        tie,
        transferKw,
        source: { before: utilPct(src), after: ((src.loadKw - transferKw) / src.capacityKw) * 100 },
        dest: { before: utilPct(target), after: ((target.loadKw + transferKw) / target.capacityKw) * 100 },
        destLevelAfter: classifyCongestion(target.loadKw + transferKw, target.capacityKw),
      };
    })
    .filter(
      (o): o is TransferOption<T> => o !== null && o.transferKw > 1 && o.destLevelAfter !== "critical",
    )
    .sort((a, b) => b.transferKw - a.transferKw);
}
