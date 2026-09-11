import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const MeterSchema = new Schema(
  {
    // Human-readable meter code emitted by the simulator/hardware, e.g. "GNR-M-00042".
    code: { type: String, required: true, unique: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    feederId: { type: Schema.Types.ObjectId, ref: "Feeder", required: true },
    type: { type: String, default: "bidirectional" },
    solarCapacityKw: { type: Number, required: true },
    status: { type: String, enum: ["online", "offline"], default: "online" },
    lastReadingAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type Meter = InferSchemaType<typeof MeterSchema>;
export const MeterModel: Model<Meter> =
  (models.Meter as Model<Meter>) || model<Meter>("Meter", MeterSchema);
