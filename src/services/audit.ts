/** Append-only audit logging for privileged actions (FR-1.5, SEC-8). */
import { connectDB } from "@/lib/db";
import { AuditLogModel } from "@/models/AuditLog";

export async function audit(
  actorId: string | null,
  action: string,
  target?: { type: string; id: string },
  metadata?: Record<string, unknown>,
): Promise<void> {
  await connectDB();
  await AuditLogModel.create({ actorId, action, target, metadata: metadata ?? {} });
}
