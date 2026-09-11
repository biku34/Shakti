import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const TradeSchema = new Schema({
  offerId: { type: Schema.Types.ObjectId, ref: "EnergyOffer", required: true },
  bidId: { type: Schema.Types.ObjectId, ref: "EnergyBid", required: true },
  sellerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  buyerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  feederId: { type: Schema.Types.ObjectId, ref: "Feeder", required: true },
  quantityKwh: { type: Number, required: true },
  pricePerKwh: { type: Number, required: true },
  totalCredits: { type: Number, required: true },
  status: { type: String, enum: ["matched", "settled", "failed"], default: "matched" },
  anchorTxHash: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  settledAt: { type: Date, default: null },
});

export type Trade = InferSchemaType<typeof TradeSchema>;
export const TradeModel: Model<Trade> =
  (models.Trade as Model<Trade>) || model<Trade>("Trade", TradeSchema);
