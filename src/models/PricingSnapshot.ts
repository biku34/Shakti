import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const PricingSnapshotSchema = new Schema({
  feederId: { type: Schema.Types.ObjectId, ref: "Feeder", required: true },
  timestamp: { type: Date, default: Date.now },
  supplyKwh: { type: Number, required: true },
  demandKwh: { type: Number, required: true },
  congestionLevel: { type: String, enum: ["low", "medium", "high"], required: true },
  clearingPrice: { type: Number, required: true },
  fitFloor: { type: Number, required: true },
  retailCeiling: { type: Number, required: true },
});

PricingSnapshotSchema.index({ feederId: 1, timestamp: -1 });

export type PricingSnapshot = InferSchemaType<typeof PricingSnapshotSchema>;
export const PricingSnapshotModel: Model<PricingSnapshot> =
  (models.PricingSnapshot as Model<PricingSnapshot>) ||
  model<PricingSnapshot>("PricingSnapshot", PricingSnapshotSchema);
