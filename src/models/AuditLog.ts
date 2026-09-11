import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/** Immutable privileged-action log (FR-1.5, SEC-8). */
const AuditLogSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  action: { type: String, required: true },
  target: {
    type: { type: String },
    id: { type: Schema.Types.ObjectId },
  },
  metadata: { type: Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now },
});

export type AuditLog = InferSchemaType<typeof AuditLogSchema>;
export const AuditLogModel: Model<AuditLog> =
  (models.AuditLog as Model<AuditLog>) || model<AuditLog>("AuditLog", AuditLogSchema);
