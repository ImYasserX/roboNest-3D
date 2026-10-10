import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type BatchStatement, type Database } from "@/server/db/client";
import { adminSessions, adminUsers } from "@/server/db/schema";
import { decryptString, encryptString } from "@/server/auth/crypto";
import { getDummyHash, hashPassword, verifyPassword } from "@/server/auth/password";
import { generateTotpSecret, totpUri, verifyTotp } from "@/server/auth/totp";
import { ADMIN_MAX_MFA_ATTEMPTS } from "@/server/auth/sessions";
import { ASSIGNABLE_ADMIN_ROLES, type AdminRole } from "@/lib/domain";
import { canManageAdmin } from "@/lib/permissions";
import { auditInsert, writeAudit, type AuditActor } from "./audit";

export const ADMIN_PASSWORD_MIN = 12;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
const TOTP_PURPOSE = "admin-totp";

const usernameField = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/);
const adminPasswordField = z.string().min(ADMIN_PASSWORD_MIN).max(128);

export type AdminLoginResult =
  | { ok: true; adminId: string; needsTotp: boolean }
  | { ok: false; error: "invalid_credentials" | "locked" };

/** Password step. Failed attempts lock the account for 15 minutes after 5 tries. */
export async function authenticateAdmin(db: Database, raw: unknown, ipHash: string | null, now = Date.now()): Promise<AdminLoginResult> {
  const parsed = z.object({ username: usernameField, password: z.string().min(1).max(128) }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_credentials" };
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.username, parsed.data.username)).limit(1);
  const valid = await verifyPassword(parsed.data.password, admin?.passwordHash ?? (await getDummyHash()));
  if (!admin || admin.status !== "ACTIVE") return { ok: false, error: "invalid_credentials" };
  // While locked, only a correct password learns about the lock (no username probing).
  if (admin.lockedUntil && admin.lockedUntil.getTime() > now) return { ok: false, error: valid ? "locked" : "invalid_credentials" };

  if (!valid) {
    const failures = admin.failedLoginCount + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    await runBatch(db, [
      db
        .update(adminUsers)
        .set({ failedLoginCount: lock ? 0 : failures, lockedUntil: lock ? new Date(now + LOCKOUT_MS) : admin.lockedUntil })
        .where(eq(adminUsers.id, admin.id)),
      auditInsert(db, { adminId: admin.id, label: admin.username, ipHash }, { action: lock ? "admin.login.locked" : "admin.login.failed", targetType: "admin", targetId: admin.id }),
    ]);
    return { ok: false, error: "invalid_credentials" };
  }
  await db.update(adminUsers).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(adminUsers.id, admin.id));
  return { ok: true, adminId: admin.id, needsTotp: admin.totpEnabled };
}

export async function recordAdminLogin(db: Database, adminId: string, username: string, ipHash: string | null) {
  await runBatch(db, [
    db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, adminId)),
    auditInsert(db, { adminId, label: username, ipHash }, { action: "admin.login", targetType: "admin", targetId: adminId }),
  ]);
}

/** TOTP step for an MFA_PENDING session. Consumes an attempt either way. */
export async function verifyAdminSecondFactor(db: Database, sessionId: string, adminId: string, code: string, appSecret: string) {
  const [session] = await db
    .update(adminSessions)
    .set({ mfaAttempts: sql`${adminSessions.mfaAttempts} + 1` })
    .where(and(eq(adminSessions.id, sessionId), eq(adminSessions.stage, "MFA_PENDING")))
    .returning({ attempts: adminSessions.mfaAttempts });
  if (!session) return { ok: false as const, error: "expired" as const };
  if (session.attempts > ADMIN_MAX_MFA_ATTEMPTS) {
    await db.delete(adminSessions).where(eq(adminSessions.id, sessionId));
    return { ok: false as const, error: "expired" as const };
  }
  const ok = await checkAdminTotp(db, adminId, code, appSecret);
  return ok ? { ok: true as const } : { ok: false as const, error: "invalid_code" as const };
}

async function checkAdminTotp(db: Database, adminId: string, code: string, appSecret: string) {
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1);
  if (!admin?.totpEnabled || !admin.totpSecretEnc) return false;
  const secret = await decryptString(appSecret, TOTP_PURPOSE, admin.totpSecretEnc);
  const counter = await verifyTotp(secret, code, admin.totpLastCounter);
  if (counter === null) return false;
  // Conditional update closes the replay race between two concurrent requests.
  const updated = await db
    .update(adminUsers)
    .set({ totpLastCounter: counter })
    .where(and(eq(adminUsers.id, adminId), sql`(${adminUsers.totpLastCounter} IS NULL OR ${adminUsers.totpLastCounter} < ${counter})`))
    .returning({ id: adminUsers.id });
  return updated.length === 1;
}

/** Starts enrollment: stores a new (not yet enabled) secret and returns it once for the QR code. */
export async function beginTotpEnrollment(db: Database, adminId: string, username: string, appSecret: string) {
  const secret = generateTotpSecret();
  await db
    .update(adminUsers)
    .set({ totpSecretEnc: await encryptString(appSecret, TOTP_PURPOSE, secret), totpEnabled: false, totpLastCounter: null })
    .where(eq(adminUsers.id, adminId));
  return { secret, uri: totpUri(secret, username) };
}

export async function confirmTotpEnrollment(db: Database, adminId: string, code: string, appSecret: string, actor: AuditActor) {
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1);
  if (!admin?.totpSecretEnc || admin.totpEnabled) return { ok: false as const, error: "no_pending_enrollment" as const };
  const secret = await decryptString(appSecret, TOTP_PURPOSE, admin.totpSecretEnc);
  const counter = await verifyTotp(secret, code, null);
  if (counter === null) return { ok: false as const, error: "invalid_code" as const };
  await runBatch(db, [
    db.update(adminUsers).set({ totpEnabled: true, totpLastCounter: counter }).where(eq(adminUsers.id, adminId)),
    auditInsert(db, actor, { action: "admin.totp.enabled", targetType: "admin", targetId: adminId }),
  ]);
  return { ok: true as const };
}

export async function changeAdminPassword(db: Database, adminId: string, current: string, next: string, keepSessionId: string, actor: AuditActor) {
  const parsed = adminPasswordField.safeParse(next);
  if (!parsed.success) return { ok: false as const, error: "password_too_short" as const };
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1);
  if (!admin || !(await verifyPassword(current, admin.passwordHash))) return { ok: false as const, error: "wrong_password" as const };
  await runBatch(db, [
    db.update(adminUsers).set({ passwordHash: await hashPassword(parsed.data), passwordChangedAt: new Date() }).where(eq(adminUsers.id, adminId)),
    db.delete(adminSessions).where(and(eq(adminSessions.adminId, adminId), ne(adminSessions.id, keepSessionId))),
    auditInsert(db, actor, { action: "admin.password.changed", targetType: "admin", targetId: adminId }),
  ]);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Admin user management (Owners and Super Admins only, enforced by callers)
// ---------------------------------------------------------------------------

export const createAdminSchema = z.object({
  username: usernameField,
  displayName: z.string().trim().min(2).max(60),
  // OWNER is never assignable here: owners come only from scripts/bootstrap-owners.ts.
  role: z.enum(ASSIGNABLE_ADMIN_ROLES),
  password: adminPasswordField,
});

export async function createAdminUser(db: Database, raw: unknown, actor: AuditActor) {
  const parsed = createAdminSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" as const };
  const [exists] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.username, parsed.data.username)).limit(1);
  if (exists) return { ok: false as const, error: "username_taken" as const };
  const id = crypto.randomUUID();
  await runBatch(db, [
    db.insert(adminUsers).values({
      id,
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      passwordHash: await hashPassword(parsed.data.password),
      passwordChangedAt: new Date(),
    }),
    auditInsert(db, actor, { action: "admin.created", targetType: "admin", targetId: id, metadata: { username: parsed.data.username, role: parsed.data.role } }),
  ]);
  return { ok: true as const, id };
}

async function activeSuperAdminCount(db: Database) {
  return db.$count(adminUsers, and(inArray(adminUsers.role, ["OWNER", "SUPER_ADMIN"]), eq(adminUsers.status, "ACTIVE")));
}

async function targetRole(db: Database, targetId: string): Promise<AdminRole | null> {
  const [row] = await db.select({ role: adminUsers.role }).from(adminUsers).where(eq(adminUsers.id, targetId)).limit(1);
  return row?.role ?? null;
}

export async function updateAdminUser(
  db: Database,
  targetId: string,
  raw: unknown,
  actor: AuditActor,
) {
  const parsed = z
    .object({ role: z.enum(ASSIGNABLE_ADMIN_ROLES), status: z.enum(["ACTIVE", "DISABLED"]), displayName: z.string().trim().min(2).max(60) })
    .safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" as const };
  const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, targetId)).limit(1);
  if (!target) return { ok: false as const, error: "not_found" as const };
  // Owners cannot be demoted, disabled or renamed from the UI (DB triggers agree).
  if (target.role === "OWNER") return { ok: false as const, error: "owner_protected" as const };
  const losesSuper = target.role === "SUPER_ADMIN" && target.status === "ACTIVE" && (parsed.data.role !== "SUPER_ADMIN" || parsed.data.status !== "ACTIVE");
  if (losesSuper && (await activeSuperAdminCount(db)) <= 1) return { ok: false as const, error: "last_super_admin" as const };
  const statements: BatchStatement[] = [
    db.update(adminUsers).set(parsed.data).where(eq(adminUsers.id, targetId)),
    auditInsert(db, actor, {
      action: "admin.updated",
      targetType: "admin",
      targetId,
      metadata: { from: { role: target.role, status: target.status }, to: { role: parsed.data.role, status: parsed.data.status } },
    }),
  ];
  // Role or status changes revoke existing sessions so new permissions apply immediately.
  if (parsed.data.role !== target.role || parsed.data.status !== target.status) {
    statements.push(db.delete(adminSessions).where(eq(adminSessions.adminId, targetId)));
  }
  await runBatch(db, statements);
  return { ok: true as const };
}

export async function setAdminPasswordBySuperAdmin(db: Database, targetId: string, password: string, actor: AuditActor, actorRole: AdminRole) {
  const parsed = adminPasswordField.safeParse(password);
  if (!parsed.success) return { ok: false as const, error: "password_too_short" as const };
  const role = await targetRole(db, targetId);
  if (!role) return { ok: false as const, error: "not_found" as const };
  if (!canManageAdmin(actorRole, role)) return { ok: false as const, error: "owner_protected" as const };
  await runBatch(db, [
    db
      .update(adminUsers)
      .set({ passwordHash: await hashPassword(parsed.data), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(adminUsers.id, targetId)),
    db.delete(adminSessions).where(eq(adminSessions.adminId, targetId)),
    auditInsert(db, actor, { action: "admin.password.reset", targetType: "admin", targetId }),
  ]);
  return { ok: true as const };
}

/** Clears another admin's TOTP (lost phone). They must re-enroll at next login if required. */
export async function resetAdminTotp(db: Database, targetId: string, actor: AuditActor, actorRole: AdminRole) {
  const role = await targetRole(db, targetId);
  if (!role) return { ok: false as const, error: "not_found" as const };
  if (!canManageAdmin(actorRole, role)) return { ok: false as const, error: "owner_protected" as const };
  await runBatch(db, [
    db.update(adminUsers).set({ totpEnabled: false, totpSecretEnc: null, totpLastCounter: null }).where(eq(adminUsers.id, targetId)),
    db.delete(adminSessions).where(eq(adminSessions.adminId, targetId)),
    auditInsert(db, actor, { action: "admin.totp.reset", targetType: "admin", targetId }),
  ]);
  return { ok: true as const };
}

export async function logAdminLogout(db: Database, actor: AuditActor) {
  await writeAudit(db, actor, { action: "admin.logout", targetType: "admin", targetId: actor.adminId ?? undefined });
}
