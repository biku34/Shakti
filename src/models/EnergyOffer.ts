import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const EnergyOfferSchema = new Schema({
  prosumerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  feederId: { type: Schema.Types.ObjectId, ref: "Feeder", required: true },
  quantityKwh: { type: Number, required: true },
  remainingKwh: { type: Number, required: true },
  askPricePerKwh: { type: Number, required: true },
  status: {
    type: String,
    enum: ["open", "partial", "filled", "expired", "cancelled"],
    default: "open",
  },
  sourceReadingIds: [{ type: Schema.Types.ObjectId, ref: "MeterReading" }],
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

EnergyOfferSchema.index({ feederId: 1, status: 1, askPricePerKwh: 1 });

export type EnergyOffer = InferSchemaType<typeof EnergyOfferSchema>;
export const EnergyOfferModel: Model<EnergyOffer> =
  (models.EnergyOffer as Model<EnergyOffer>) ||
  model<EnergyOffer>("EnergyOffer", EnergyOfferSchema);
