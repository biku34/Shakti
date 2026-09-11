import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { ROLES } from "@/lib/roles";

const UserSchema = new Schema(
  {
    role: { type: String, enum: ROLES, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    feederId: { type: Schema.Types.ObjectId, ref: "Feeder", default: null },
    creditBalance: { type: Number, default: 100 },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } },
);

export type User = InferSchemaType<typeof UserSchema>;
export const UserModel: Model<User> =
  (models.User as Model<User>) || model<User>("User", UserSchema);
