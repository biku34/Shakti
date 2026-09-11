import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const FRAUD_TYPES = [
  "duplicate_rec",
  "over_claim",
  "offline_generation",
  "night_generation",
  "volume_mismatch",
  "velocity",
  "cross_feeder",
] as const;

const FraudAlertSchema = new Schema({
  type: { type: String, enum: FRAUD_TYPES, required: true },
  severity: { type: String, enum: ["low", "medium", "high", "critical"], required: true },
  subjectType: { type: String, enum: ["rec", "meter", "prosumer", "trade"], required: true },
  subjectId: { type: Schema.Types.ObjectId, required: true },
  ruleId: { type: String, required: true },
  evidence: { type: Schema.Types.Mixed, default: {} },
  status: {
    type: String,
    enum: ["open", "investigating", "confirmed", "dismissed"],
    default: "open",
  },
  createdAt: { type: Date, default: Date.now },
  resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
});

export type FraudAlert = InferSchemaType<typeof FraudAlertSchema>;
export const FraudAlertModel: Model<FraudAlert> =
  (models.FraudAlert as Model<FraudAlert>) ||
  model<FraudAlert>("FraudAlert", FraudAlertSchema);
