import { and, eq, gt, lt } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { adminSessions, adminUsers, sessions, users } from "@/server/db/schema";
import { randomToken, sha256Hex } from "./crypto";

// Opaque, random session tokens. Only SHA-256(token) is stored, so a database
// leak does not yield usable cookies. Sessions are revocable server-side.

export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // absolute
export const ADMIN_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const ADMIN_MFA_PENDING_TTL_MS = 10 * 60 * 1000;
export const ADMIN_MAX_MFA_ATTEMPTS = 5;

type Meta = { ipHash?: string | null; userAgent?: string | null };

export async function createCustomerSession(db: Database, userId: string, meta: Meta = {}, now = Date.now()) {
  const token = randomToken();
  await db.insert(sessions).values({
    id: await sha256Hex(token),
    userId,
    expiresAt: new Date(now + CUSTOMER_SESSION_TTL_MS),
    lastSeenAt: new Date(now),
    ipHash: meta.ipHash ?? null,
    userAgent: meta.userAgent ?? null,
  });
  // Opportunistic purge of this user's expired sessions.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date(now))));
  return { token, expiresAt: new Date(now + CUSTOMER_SESSION_TTL_MS) };
}

export type CustomerSessionUser = { id: string; name: string; phone: string; locale: string };

export async function validateCustomerSession(
  db: Database,
  token: string,
  now = Date.now(),
): Promise<CustomerSessionUser | null> {
  if (!token || token.length > 128) return null;
  const rows = await db
    .select({ id: users.id, name: users.name, phone: users.phone, locale: users.locale, status: users.status })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, await sha256Hex(token)), gt(sessions.expiresAt, new Date(now))))
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== "ACTIVE") return null;
  return { id: row.id, name: row.name, phone: row.phone, locale: row.locale };
}

export async function deleteCustomerSession(db: Database, token: string) {
  await db.delete(sessions).where(eq(sessions.id, await sha256Hex(token)));
}

export async function deleteAllCustomerSessions(db: Database, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// ---------------------------------------------------------------------------
// Admin sessions
// ---------------------------------------------------------------------------

export type AdminSessionStage = "MFA_PENDING" | "ACTIVE";

export async function createAdminSession(
  db: Database,
  adminId: string,
  stage: AdminSessionStage,
  meta: Meta = {},
  now = Date.now(),
) {
  const token = randomToken();
  const ttl = stage === "MFA_PENDING" ? ADMIN_MFA_PENDING_TTL_MS : ADMIN_SESSION_TTL_MS;
  await db.insert(adminSessions).values({
    id: await sha256Hex(token),
    adminId,
    stage,
    expiresAt: new Date(now + ttl),
    lastSeenAt: new Date(now),
    ipHash: meta.ipHash ?? null,
    userAgent: meta.userAgent ?? null,
  });
  await db.delete(adminSessions).where(and(eq(adminSessions.adminId, adminId), lt(adminSessions.expiresAt, new Date(now))));
  return { token, expiresAt: new Date(now + ttl) };
}

export type AdminSession = {
  sessionId: string;
  stage: AdminSessionStage;
  mfaAttempts: number;
  admin: {
    id: string;
    username: string;
    displayName: string;
    role: "SUPER_ADMIN" | "OPERATIONS";
    totpEnabled: boolean;
  };
};

export async function validateAdminSession(db: Database, token: string, now = Date.now()): Promise<AdminSession | null> {
  if (!token || token.length > 128) return null;
  const sessionId = await sha256Hex(token);
  const rows = await db
    .select({
      stage: adminSessions.stage,
      lastSeenAt: adminSessions.lastSeenAt,
      expiresAt: adminSessions.expiresAt,
      mfaAttempts: adminSessions.mfaAttempts,
      id: adminUsers.id,
      username: adminUsers.username,
      displayName: adminUsers.displayName,
      role: adminUsers.role,
      totpEnabled: adminUsers.totpEnabled,
      status: adminUsers.status,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
    .where(eq(adminSessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== "ACTIVE") return null;
  const idleExpired = row.stage === "ACTIVE" && now - row.lastSeenAt.getTime() > ADMIN_IDLE_TIMEOUT_MS;
  if (row.expiresAt.getTime() <= now || idleExpired) {
    await db.delete(adminSessions).where(eq(adminSessions.id, sessionId));
    return null;
  }
  // Refresh the idle timer at most once a minute to limit writes.
  if (now - row.lastSeenAt.getTime() > 60_000) {
    await db.update(adminSessions).set({ lastSeenAt: new Date(now) }).where(eq(adminSessions.id, sessionId));
  }
  return {
    sessionId,
    stage: row.stage,
    mfaAttempts: row.mfaAttempts,
    admin: {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
      totpEnabled: row.totpEnabled,
    },
  };
}

export async function deleteAdminSessionById(db: Database, sessionId: string) {
  await db.delete(adminSessions).where(eq(adminSessions.id, sessionId));
}

export async function deleteAllAdminSessions(db: Database, adminId: string) {
  await db.delete(adminSessions).where(eq(adminSessions.adminId, adminId));
}
