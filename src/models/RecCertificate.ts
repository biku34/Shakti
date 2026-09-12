import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const RecCertificateSchema = new Schema({
  serial: { type: String, required: true, unique: true }, // e.g. REC-GNR-2025-000123
  generatorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  meterId: { type: Schema.Types.ObjectId, ref: "Meter", required: true },
  feederId: { type: Schema.Types.ObjectId, ref: "Feeder", required: true },
  energyMwh: { type: Number, required: true },
  generationWindow: {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
  },
  backingReadingIds: [{ type: Schema.Types.ObjectId, ref: "MeterReading" }],
  // kWh this REC reserved from each backing reading, index-aligned with
  // backingReadingIds. A reading may be partially consumed, so this is the
  // authoritative "backing" volume for fraud rule R-06 (not the reading's full export).
  backingReadingKwh: [{ type: Number }],
  status: {
    type: String,
    enum: ["pending", "issued", "transferred", "retired", "revoked"],
    default: "pending",
  },
  currentHolderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  // Credits paid to the generator when this REC was issued (0 while pending).
  creditsAwarded: { type: Number, default: 0 },
  // Secondary-market listing (industry-standard REC resale). A holder lists an
  // issued/transferred REC at a credits price; a buyer purchases it, moving
  // credits and ownership. Cleared on sale, retire, transfer or revoke.
  listed: { type: Boolean, default: false },
  askCreditsPerKwh: { type: Number, default: null },
  listedAt: { type: Date, default: null },
  // Per-REC AI anomaly review, refreshed on each state change (issue / list /
  // transfer) and by the registry sweep. Surfaced as a flag in the REC registry.
  aiReview: {
    state: { type: String, enum: ["unchecked", "clean", "flagged", "error"], default: "unchecked" },
    severity: { type: String, default: null },
    reason: { type: String, default: null },
    model: { type: String, default: null },
    checkedAt: { type: Date, default: null },
  },
  issueTxHash: { type: String, default: null },
  contentHash: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

RecCertificateSchema.index({ meterId: 1, "generationWindow.from": 1 });

export type RecCertificate = InferSchemaType<typeof RecCertificateSchema>;
export const RecCertificateModel: Model<RecCertificate> =
  (models.RecCertificate as Model<RecCertificate>) ||
  model<RecCertificate>("RecCertificate", RecCertificateSchema);
