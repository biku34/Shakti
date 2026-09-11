/**
 * Centralised, validated access to server-side environment variables.
 * SEC-5 / SEC-6: none of these are ever imported into a client component.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  mongoUri: () => required("MONGODB_URI"),
  mongoDb: () => process.env.MONGODB_DB || "reip",

  authSecret: () => required("AUTH_SECRET"),
  sessionCookie: () => process.env.SESSION_COOKIE || "reip_session",
  sessionTtlHours: () => num("SESSION_TTL_HOURS", 12),

  simServiceToken: () => required("SIM_SERVICE_TOKEN"),

  alchemyApiKey: () => process.env.ALCHEMY_API_KEY || "",
  alchemyNetwork: () => process.env.ALCHEMY_NETWORK || "polygon-amoy",
  anchorPrivateKey: () => process.env.ANCHOR_PRIVATE_KEY || "",
  anchorFromAddress: () => process.env.ANCHOR_FROM_ADDRESS || "",
  blockchainMock: () => (process.env.BLOCKCHAIN_MOCK || "true") === "true",

  pricing: {
    base: () => num("PRICING_BASE", 5.75),
    alpha: () => num("PRICING_ALPHA", 0.6),
    beta: () => num("PRICING_BETA", 1.0),
    fitFloor: () => num("PRICING_FIT_FLOOR", 3.0),
    retailCeiling: () => num("PRICING_RETAIL_CEILING", 8.5),
  },

  groqApiKey: () => process.env.GROQ_API_KEY || "",
};
