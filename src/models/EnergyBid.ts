import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const EnergyBidSchema = new Schema({
  consumerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  feederId: { type: Schema.Types.ObjectId, ref: "Feeder", required: true },
  quantityKwh: { type: Number, required: true },
  remainingKwh: { type: Number, required: true },
  maxPricePerKwh: { type: Number, required: true },
  status: {
    type: String,
    enum: ["open", "partial", "filled", "expired", "cancelled"],
    default: "open",
  },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

EnergyBidSchema.index({ feederId: 1, status: 1, maxPricePerKwh: -1 });

export type EnergyBid = InferSchemaType<typeof EnergyBidSchema>;
export const EnergyBidModel: Model<EnergyBid> =
  (models.EnergyBid as Model<EnergyBid>) || model<EnergyBid>("EnergyBid", EnergyBidSchema);
