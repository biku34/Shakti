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

  // Credits paid to the generator when a REC is issued (per MWh certified).
  // 2500 cr/MWh = 2.5 cr/kWh — the green-attribute value, below the ~5.75
  // energy clearing price since a REC certifies attributes, not the kWh itself.
  rec: {
    creditPerMwh: () => num("REC_CREDIT_PER_MWH", 2500),
  },

  groqApiKey: () => process.env.GROQ_API_KEY || "",
  // Pool of Groq keys (comma-separated) for rate-limit failover; falls back to
  // the single GROQ_API_KEY. Empty when the agentic layer is not configured.
  groqApiKeys: (): string[] => {
    const pool = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    return pool;
  },
  groqModel: () => process.env.GROQ_MODEL || "openai/gpt-oss-20b",

  // Transactional email (auditor report delivery). Left empty until the
  // Resend key is provisioned — the email route degrades gracefully.
  resendApiKey: () => process.env.RESEND_API_KEY || "",
  resendFrom: () => process.env.RESEND_FROM || "Shakti Audit <onboarding@resend.dev>",
};
