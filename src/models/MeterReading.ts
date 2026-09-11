import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * Time-series meter reading (§5.4). Shared source of truth for trading, REC
 * issuance and fraud detection (§3.3). `committedExportKwh` tracks how much of
 * this reading's export has been sold or backed a REC, preventing double-use
 * (FR-3.2, FR-6.6).
 */
const MeterReadingSchema = new Schema({
  meterId: { type: Schema.Types.ObjectId, ref: "Meter", required: true },
  feederId: { type: Schema.Types.ObjectId, ref: "Feeder", required: true },
  timestamp: { type: Date, required: true },
  intervalMinutes: { type: Number, default: 15 },
  generationKwh: { type: Number, required: true },
  consumptionKwh: { type: Number, required: true },
  importKwh: { type: Number, default: 0 },
  exportKwh: { type: Number, default: 0 },
  irradianceFactor: { type: Number, default: 0 },
  meterStatus: { type: String, enum: ["online", "offline"], default: "online" },
  verified: { type: Boolean, default: false },
  // Coherence bookkeeping (not in the base SRS schema; enforces §3.3):
  committedExportKwh: { type: Number, default: 0 }, // reserved by open/filled offers
  recBackedKwh: { type: Number, default: 0 }, // consumed by issued RECs
});

MeterReadingSchema.index({ meterId: 1, timestamp: -1 });
MeterReadingSchema.index({ feederId: 1, timestamp: -1 });

export type MeterReading = InferSchemaType<typeof MeterReadingSchema>;
export const MeterReadingModel: Model<MeterReading> =
  (models.MeterReading as Model<MeterReading>) ||
  model<MeterReading>("MeterReading", MeterReadingSchema);
