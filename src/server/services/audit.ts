import type { Database } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";

export type AuditActor = { adminId: string | null; label: string; ipHash?: string | null };

export type AuditEntry = {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

const SENSITIVE_KEY = /pass|secret|token|totp|otp|hash|cookie/i;

/** Drops any metadata field whose name suggests a credential. */
export function sanitizeAuditMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return undefined;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !SENSITIVE_KEY.test(key)));
}

export function auditInsert(db: Database, actor: AuditActor, entry: AuditEntry) {
  return db.insert(auditLogs).values({
    actorAdminId: actor.adminId,
    actorLabel: actor.label,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: sanitizeAuditMetadata(entry.metadata),
    ipHash: actor.ipHash ?? null,
  });
}

export async function writeAudit(db: Database, actor: AuditActor, entry: AuditEntry) {
  await auditInsert(db, actor, entry);
}
