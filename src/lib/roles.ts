/** The six user classes (§2.3). Single source of truth for RBAC. */
export const ROLES = [
  "prosumer",
  "consumer",
  "utility",
  "regulator",
  "certificate_body",
  "auditor",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(x: unknown): x is Role {
  return typeof x === "string" && (ROLES as readonly string[]).includes(x);
}
