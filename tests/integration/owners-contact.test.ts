import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { adminUsers, contactMessages } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { createAdminUser, resetAdminTotp, setAdminPasswordBySuperAdmin, updateAdminUser } from "@/server/services/admin-auth";
import { contactFormToken, isHumanPaced, submitContactMessage } from "@/server/services/contact";
import { OWNERS, ownerInsertSql } from "../../scripts/lib/owners";
import { startPlatform, type TestPlatform } from "../support/platform";
import { dbError } from "../support/fakes";
import { fakeFetch, json } from "../support/fakes";

let p: TestPlatform;
const actor = { adminId: null, label: "test" };
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

async function provision(key: keyof typeof OWNERS, username: string) {
  const statement = ownerInsertSql({ id: crypto.randomUUID(), username, displayName: OWNERS[key].displayName, passwordHash: await hashPassword("owner-password-long"), now: Date.now() });
  await p.env.DB.prepare(statement).run();
}

describe("owner provisioning and protection", () => {
  it("provisions exactly the two named owners, idempotently, and refuses a third", async () => {
    await provision("yasser", "yasser");
    await provision("yasser", "yasser-again"); // same owner again: no-op
    await provision("ayman", "ayman");
    const owners = await p.db.select({ displayName: adminUsers.displayName, role: adminUsers.role, totpEnabled: adminUsers.totpEnabled }).from(adminUsers).where(eq(adminUsers.role, "OWNER"));
    expect(owners.map((o) => o.displayName).sort()).toEqual(["Ayman Ramadhan", "Yasser Elyas"]);
    expect(owners.every((o) => o.totpEnabled === false)).toBe(true); // TOTP enrollment is forced at first sign-in
    expect(await dbError(p.db.insert(adminUsers).values({ username: "third", displayName: "Third", role: "OWNER", passwordHash: await hashPassword("owner-password-long") }))).toMatch(/owner_limit/);
  });

  it("cannot be created, demoted, disabled or deleted through the app or the database", async () => {
    expect(await createAdminUser(p.db, { username: "sneaky", displayName: "Sneaky", role: "OWNER", password: "long-enough-password" }, actor)).toEqual({ ok: false, error: "invalid_input" });
    const [yasser] = await p.db.select().from(adminUsers).where(eq(adminUsers.username, "yasser"));
    expect(await updateAdminUser(p.db, yasser.id, { role: "OPERATIONS", status: "ACTIVE", displayName: "Yasser Elyas" }, actor)).toEqual({ ok: false, error: "owner_protected" });
    expect(await updateAdminUser(p.db, yasser.id, { role: "SUPER_ADMIN", status: "DISABLED", displayName: "Yasser Elyas" }, actor)).toEqual({ ok: false, error: "owner_protected" });
    expect(await dbError(p.db.update(adminUsers).set({ role: "OPERATIONS" }).where(eq(adminUsers.id, yasser.id)))).toMatch(/owner_protected/);
    expect(await dbError(p.db.update(adminUsers).set({ status: "DISABLED" }).where(eq(adminUsers.id, yasser.id)))).toMatch(/owner_protected/);
    expect(await dbError(p.db.delete(adminUsers).where(eq(adminUsers.id, yasser.id)))).toMatch(/owner_protected/);
    // Promoting an existing admin into OWNER is blocked too.
    const ops = await createAdminUser(p.db, { username: "opsuser", displayName: "Ops", role: "OPERATIONS", password: "long-enough-password" }, actor);
    if (!ops.ok) throw new Error();
    expect(await dbError(p.db.update(adminUsers).set({ role: "OWNER" }).where(eq(adminUsers.id, ops.id)))).toMatch(/owner_protected/);
  });

  it("only another owner can reset an owner's password or authenticator", async () => {
    const [yasser] = await p.db.select().from(adminUsers).where(eq(adminUsers.username, "yasser"));
    expect(await setAdminPasswordBySuperAdmin(p.db, yasser.id, "a-new-long-password", actor, "SUPER_ADMIN")).toEqual({ ok: false, error: "owner_protected" });
    expect(await resetAdminTotp(p.db, yasser.id, actor, "SUPER_ADMIN")).toEqual({ ok: false, error: "owner_protected" });
    expect(await setAdminPasswordBySuperAdmin(p.db, yasser.id, "a-new-long-password", actor, "OWNER")).toEqual({ ok: true });
    expect(await resetAdminTotp(p.db, yasser.id, actor, "OWNER")).toEqual({ ok: true });
  });
});

describe("contact form", () => {
  const config = { apiKey: "re_test_SECRETKEY123", from: "RoboNest.3D <no-reply@robonest.tech>", to: "team@example.test" };
  const valid = { name: "Visitor", email: "Visitor@Example.com", subject: "Quote", message: "Please quote ten brackets.", locale: "en" };

  it("validates and sanitizes input on the server", async () => {
    const bad = await submitContactMessage(p.db, { name: "V", email: "nope", subject: "Line\nbreak", message: "short", locale: "en" }, { config });
    expect(bad).toMatchObject({ ok: false, error: "invalid" });
    if (!bad.ok && bad.error === "invalid") expect(bad.fields.sort()).toEqual(["email", "message", "name", "subject"]);
    const spammy = await submitContactMessage(p.db, { ...valid, message: "http://a.x http://b.x http://c.x http://d.x buy now" }, { config });
    expect(spammy).toMatchObject({ ok: false, error: "invalid" });
    expect(await submitContactMessage(p.db, { ...valid, message: "x".repeat(3001) }, { config })).toMatchObject({ ok: false, error: "invalid" });
  });

  it("sends through Resend with the configured sender, recipient and reply-to", async () => {
    const f = fakeFetch(json({ id: "email_1" }));
    expect(await submitContactMessage(p.db, valid, { config, fetchImpl: f.fetchImpl })).toEqual({ ok: true });
    expect(f.calls[0].url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(f.calls[0].init?.body));
    expect(body).toMatchObject({ from: config.from, to: [config.to], reply_to: "visitor@example.com" });
    expect(body.text).toContain("Please quote ten brackets.");
    expect((f.calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${config.apiKey}`);
    const [row] = await p.db.select().from(contactMessages).where(eq(contactMessages.email, "visitor@example.com"));
    expect(row.deliveryStatus).toBe("SENT");
  });

  it("reports failure (never success) when Resend rejects, errors, or is not configured", async () => {
    const rejected = fakeFetch(json({ message: "domain not verified" }, 403));
    expect(await submitContactMessage(p.db, valid, { config, fetchImpl: rejected.fetchImpl })).toEqual({ ok: false, error: "delivery_failed" });
    const down = fakeFetch(new TypeError("fetch failed"));
    expect(await submitContactMessage(p.db, valid, { config, fetchImpl: down.fetchImpl })).toEqual({ ok: false, error: "delivery_failed" });
    expect(await submitContactMessage(p.db, valid, { config: null })).toEqual({ ok: false, error: "not_configured" });
    const statuses = await p.db.select({ s: contactMessages.deliveryStatus }).from(contactMessages).where(sql`${contactMessages.deliveryStatus} <> 'SENT'`);
    expect(statuses.map((r) => r.s).sort()).toEqual(["FAILED", "FAILED", "NOT_CONFIGURED"]);
  });

  it("rejects forms submitted faster than a human could, and forged timestamps", async () => {
    const secret = "test-app-secret-at-least-32-characters-long";
    const now = Date.now();
    const token = await contactFormToken(secret, now);
    expect(await isHumanPaced(secret, token, now + 500)).toBe(false);
    expect(await isHumanPaced(secret, token, now + 5_000)).toBe(true);
    expect(await isHumanPaced(secret, `${now - 10_000}.${"0".repeat(32)}`, now)).toBe(false);
    expect(await isHumanPaced(secret, undefined, now)).toBe(false);
  });
});
