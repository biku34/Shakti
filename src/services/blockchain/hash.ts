import { createHash } from "crypto";

/**
 * Deterministic canonical JSON: keys sorted recursively so the same logical
 * record always hashes to the same value (BC-4). Used as the anchoring basis
 * and re-derived on verification (BC-7, FR-8.4).
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortValue(obj[k]);
        return acc;
      }, {});
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** contentHash = sha256(canonicalJSON(record)), 0x-prefixed (BC-4). */
export function contentHash(record: unknown): string {
  const digest = createHash("sha256").update(canonicalJSON(record)).digest("hex");
  return "0x" + digest;
}
