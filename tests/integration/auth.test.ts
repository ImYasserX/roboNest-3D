import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminSessions, adminUsers, auditLogs, sessions } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { totpCode, currentCounter } from "@/server/auth/totp";
import { createAdminSession, createCustomerSession, validateAdminSession, validateCustomerSession, ADMIN_IDLE_TIMEOUT_MS } from "@/server/auth/sessions";
import { authenticateAdmin, beginTotpEnrollment, confirmTotpEnrollment, createAdminUser, updateAdminUser, verifyAdminSecondFactor, MAX_FAILED_LOGINS } from "@/server/services/admin-auth";
import { authenticateCustomer, changeCustomerPassword, createPasswordResetToken, registerCustomer, resetPasswordWithToken } from "@/server/services/customer-auth";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { auditInsert } from "@/server/services/audit";
import { startPlatform, type TestPlatform } from "../support/platform";

let p: TestPlatform;
const SECRET = "test-app-secret-at-least-32-characters-long";
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

async function makeAdmin(role: "SUPER_ADMIN" | "OPERATIONS" = "OPERATIONS") {
  const username = `adm${Math.random().toString(36).slice(2, 8)}`;
  const [a] = await p.db.insert(adminUsers).values({ username, displayName: "A", role, passwordHash: await hashPassword("correct-horse-battery") }).returning();
  return a;
}

describe("customer accounts", () => {
  it("registers with a normalized phone and refuses duplicates", async () => {
    const r = await registerCustomer(p.db, { name: "Hussein", phone: "0781 234 5678", password: "longenough" }, "ar");
    expect(r.ok).toBe(true);
    expect(await registerCustomer(p.db, { name: "Other", phone: "+9647812345678", password: "longenough" }, "ar")).toMatchObject({ ok: false, error: "phone_taken" });
    expect(await registerCustomer(p.db, { name: "X", phone: "123", password: "short" }, "ar")).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("returns the same generic error for unknown phone and wrong password", async () => {
    await registerCustomer(p.db, { name: "Noor", phone: "07711111111", password: "longenough" }, "ar");
    const wrong = await authenticateCustomer(p.db, { phone: "07711111111", password: "WRONGPASS" });
    const unknown = await authenticateCustomer(p.db, { phone: "07799999999", password: "longenough" });
    expect(wrong).toEqual(unknown);
    expect((await authenticateCustomer(p.db, { phone: "0771 111 1111", password: "longenough" })).ok).toBe(true);
  });

  it("invalidates all sessions after a password change or reset, and reset tokens are single-use", async () => {
    const reg = await registerCustomer(p.db, { name: "Layla", phone: "07722222222", password: "longenough" }, "en");
    if (!reg.ok) throw new Error();
    const { token } = await createCustomerSession(p.db, reg.userId);
    expect(await validateCustomerSession(p.db, token)).not.toBeNull();
    expect(await changeCustomerPassword(p.db, reg.userId, "nope", "newpassword1")).toMatchObject({ ok: false, error: "wrong_password" });
    expect(await changeCustomerPassword(p.db, reg.userId, "longenough", "newpassword1")).toEqual({ ok: true });
    expect(await validateCustomerSession(p.db, token)).toBeNull();

    const admin = await makeAdmin();
    const resetToken = await createPasswordResetToken(p.db, reg.userId, admin.id);
    expect(await resetPasswordWithToken(p.db, resetToken, "another-pass")).toEqual({ ok: true });
    expect(await resetPasswordWithToken(p.db, resetToken, "yet-another")).toMatchObject({ ok: false, error: "invalid_token" });
    expect((await authenticateCustomer(p.db, { phone: "07722222222", password: "another-pass" })).ok).toBe(true);
    const expired = await createPasswordResetToken(p.db, reg.userId, admin.id, Date.now() - 2 * 3600_000);
    expect(await resetPasswordWithToken(p.db, expired, "whatever-pass")).toMatchObject({ ok: false });
  });

  it("stores only hashed session tokens and rejects expired sessions", async () => {
    const reg = await registerCustomer(p.db, { name: "Ali", phone: "07733333333", password: "longenough" }, "en");
    if (!reg.ok) throw new Error();
    const { token } = await createCustomerSession(p.db, reg.userId, {}, Date.now() - 31 * 86_400_000);
    const rows = await p.db.select().from(sessions).where(eq(sessions.userId, reg.userId));
    expect(rows.every((r) => r.id !== token)).toBe(true);
    expect(await validateCustomerSession(p.db, token)).toBeNull();
  });
});

describe("administrators", () => {
  it("locks the account after repeated failures without revealing it to wrong passwords", async () => {
    const a = await makeAdmin();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      expect(await authenticateAdmin(p.db, { username: a.username, password: "bad" }, null)).toEqual({ ok: false, error: "invalid_credentials" });
    }
    expect(await authenticateAdmin(p.db, { username: a.username, password: "bad" }, null)).toEqual({ ok: false, error: "invalid_credentials" });
    expect(await authenticateAdmin(p.db, { username: a.username, password: "correct-horse-battery" }, null)).toEqual({ ok: false, error: "locked" });
    expect(await p.db.$count(auditLogs, eq(auditLogs.action, "admin.login.locked"))).toBeGreaterThan(0);
  });

  it("requires a valid, non-replayed TOTP code for MFA-pending sessions", async () => {
    const a = await makeAdmin("SUPER_ADMIN");
    const { secret } = await beginTotpEnrollment(p.db, a.id, a.username, SECRET);
    const actor = { adminId: a.id, label: a.username };
    const c = currentCounter();
    expect(await confirmTotpEnrollment(p.db, a.id, await totpCode(secret, c), SECRET, actor)).toEqual({ ok: true });
    const login = await authenticateAdmin(p.db, { username: a.username, password: "correct-horse-battery" }, null);
    expect(login).toEqual({ ok: true, adminId: a.id, needsTotp: true });

    const { token } = await createAdminSession(p.db, a.id, "MFA_PENDING");
    const session = (await validateAdminSession(p.db, token))!;
    expect(session.stage).toBe("MFA_PENDING");
    // The code used for enrollment cannot be replayed.
    expect(await verifyAdminSecondFactor(p.db, session.sessionId, a.id, await totpCode(secret, c), SECRET)).toEqual({ ok: false, error: "invalid_code" });
    expect(await verifyAdminSecondFactor(p.db, session.sessionId, a.id, await totpCode(secret, c + 1), SECRET)).toEqual({ ok: true });
  });

  it("burns the MFA session after too many wrong codes", async () => {
    const a = await makeAdmin("SUPER_ADMIN");
    const { secret } = await beginTotpEnrollment(p.db, a.id, a.username, SECRET);
    await confirmTotpEnrollment(p.db, a.id, await totpCode(secret, currentCounter()), SECRET, { adminId: a.id, label: "x" });
    const { token } = await createAdminSession(p.db, a.id, "MFA_PENDING");
    const s = (await validateAdminSession(p.db, token))!;
    for (let i = 0; i < 5; i++) await verifyAdminSecondFactor(p.db, s.sessionId, a.id, "000000", SECRET);
    expect(await verifyAdminSecondFactor(p.db, s.sessionId, a.id, "000000", SECRET)).toEqual({ ok: false, error: "expired" });
    expect(await validateAdminSession(p.db, token)).toBeNull();
  });

  it("expires idle admin sessions and revokes sessions on role change", async () => {
    const a = await makeAdmin();
    const { token } = await createAdminSession(p.db, a.id, "ACTIVE", {}, Date.now() - ADMIN_IDLE_TIMEOUT_MS - 60_000);
    expect(await validateAdminSession(p.db, token)).toBeNull();
    const fresh = await createAdminSession(p.db, a.id, "ACTIVE");
    const actor = { adminId: null, label: "super" };
    expect(await updateAdminUser(p.db, a.id, { role: "SUPER_ADMIN", status: "ACTIVE", displayName: "Admin A" }, actor)).toEqual({ ok: true });
    expect(await validateAdminSession(p.db, fresh.token)).toBeNull();
    expect(await p.db.$count(adminSessions, eq(adminSessions.adminId, a.id))).toBe(0);
  });

  it("never lets the last active Super Admin be demoted or disabled", async () => {
    await p.db.update(adminUsers).set({ status: "DISABLED" }).where(eq(adminUsers.role, "SUPER_ADMIN"));
    const only = await makeAdmin("SUPER_ADMIN");
    const res = await updateAdminUser(p.db, only.id, { role: "OPERATIONS", status: "ACTIVE", displayName: "Admin A" }, { adminId: null, label: "x" });
    expect(res).toEqual({ ok: false, error: "last_super_admin" });
    expect(await createAdminUser(p.db, { username: "short", displayName: "S", role: "OPERATIONS", password: "tooshort" }, { adminId: null, label: "x" })).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("rate limiting and audit hygiene", () => {
  it("blocks after the limit within a window and resets in the next window", async () => {
    const now = 1_800_000_000_000;
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await consumeRateLimit(p.db, "customerLoginPhone", "+9647700000000", now));
    expect(results).toEqual([true, true, true, true, true, false]);
    expect(await consumeRateLimit(p.db, "customerLoginPhone", "+9647700000000", now + 16 * 60_000)).toBe(true);
  });

  it("strips credential-like fields from audit metadata", async () => {
    await auditInsert(p.db, { adminId: null, label: "t" }, { action: "test.audit", metadata: { password: "x", totpSecret: "y", sessionToken: "z", orderNumber: "RN-1" } });
    const [row] = await p.db.select().from(auditLogs).where(eq(auditLogs.action, "test.audit"));
    expect(row.metadata).toEqual({ orderNumber: "RN-1" });
  });
});
