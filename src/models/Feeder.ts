import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const FeederSchema = new Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  capacityKw: { type: Number, required: true },
  currentLoadKw: { type: Number, default: 0 },
  congestionLevel: { type: String, enum: ["low", "medium", "high"], default: "low" },
  connectedMeters: [{ type: Schema.Types.ObjectId, ref: "Meter" }],
});

export type Feeder = InferSchemaType<typeof FeederSchema>;
export const FeederModel: Model<Feeder> =
  (models.Feeder as Model<Feeder>) || model<Feeder>("Feeder", FeederSchema);
