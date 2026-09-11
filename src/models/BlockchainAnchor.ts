import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const BlockchainAnchorSchema = new Schema({
  refType: { type: String, enum: ["rec", "trade", "rec_txn"], required: true },
  refId: { type: Schema.Types.ObjectId, required: true },
  contentHash: { type: String, required: true },
  network: { type: String, default: "polygon-amoy" },
  txHash: { type: String, default: null },
  blockNumber: { type: Number, default: 0 },
  status: { type: String, enum: ["pending", "confirmed", "failed"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
});

export type BlockchainAnchor = InferSchemaType<typeof BlockchainAnchorSchema>;
export const BlockchainAnchorModel: Model<BlockchainAnchor> =
  (models.BlockchainAnchor as Model<BlockchainAnchor>) ||
  model<BlockchainAnchor>("BlockchainAnchor", BlockchainAnchorSchema);
