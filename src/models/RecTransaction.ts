import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const RecTransactionSchema = new Schema({
  recId: { type: Schema.Types.ObjectId, ref: "RecCertificate", required: true },
  action: { type: String, enum: ["issue", "transfer", "retire", "revoke"], required: true },
  fromId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  toId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  anchorTxHash: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
});

export type RecTransaction = InferSchemaType<typeof RecTransactionSchema>;
export const RecTransactionModel: Model<RecTransaction> =
  (models.RecTransaction as Model<RecTransaction>) ||
  model<RecTransaction>("RecTransaction", RecTransactionSchema);
