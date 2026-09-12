// Shared synthetic feeder zones scattered across Gandhinagar.
//
// These are demo feeders (everything except the live DB feeder GNR-F-011).
// Both the congestion map and the Feeder Monitor render from the SAME zone
// state, so a load transfer done on the map is reflected in the monitor list.

export type Zone = {
  id: string;
  code: string;
  area: string;
  center: [number, number];
  radiusM: number;
  capacityKw: number;
  loadKw: number;
  meterCount: number;
};

// Scattered Gandhinagar areas: [name, lat, lng, capacityKw, utilisation fraction].
const AREAS: [string, number, number, number, number][] = [
  ["Sector 1", 23.2385, 72.6455, 420, 0.55],
  ["Sector 7", 23.228, 72.6335, 500, 0.82],
  ["Sector 16", 23.2175, 72.623, 360, 1.08],
  ["Sector 24", 23.211, 72.615, 450, 0.63],
  ["Pethapur", 23.2455, 72.664, 300, 0.35],
  ["Sargasan", 23.205, 72.611, 520, 0.94],
  ["Sector 30", 23.1965, 72.6165, 400, 0.72],
  ["Infocity / DAIICT", 23.189, 72.6285, 480, 1.15],
  ["Randesan", 23.1985, 72.6545, 340, 0.48],
  ["Kudasan", 23.1795, 72.636, 460, 0.88],
  ["Raysan", 23.171, 72.648, 380, 0.6],
  ["Uvarsad", 23.159, 72.6255, 320, 0.3],
];

/** Fresh copy of the initial zone field (safe to hold in component state). */
export function buildInitialZones(): Zone[] {
  return AREAS.map(([area, lat, lng, capacityKw, utilFrac], i) => ({
    id: `gnr-z-${i}`,
    code: `GNR-F-Z${String(i + 1).padStart(2, "0")}`,
    area,
    center: [lat, lng] as [number, number],
    radiusM: 700,
    capacityKw,
    loadKw: Number((capacityKw * utilFrac).toFixed(1)),
    // Plausible metering-point count for the feeder, scaled off its capacity
    // (~one connection per 11.5 kW) so the monitor never shows an empty feeder.
    meterCount: Math.max(1, Math.round(capacityKw / 11.5)),
  }));
}
