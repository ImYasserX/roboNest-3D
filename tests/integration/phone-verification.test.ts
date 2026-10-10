import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { phoneVerifications, sessions, users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { createCustomerSession, validateCustomerSession } from "@/server/auth/sessions";
import { authenticateCustomer, customerPasswordSchema, findUserIdForRecovery, prepareRegistration } from "@/server/services/customer-auth";
import { checkCode, completeReset, describeChallenge, MAX_CODE_ATTEMPTS, resendCode, startChallenge, RESEND_COOLDOWN_MS } from "@/server/services/phone-verification";
import { startPlatform, type TestPlatform } from "../support/platform";
import { fakeVerifier } from "../support/fakes";

let p: TestPlatform;
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

async function beginRegistration(verifier: ReturnType<typeof fakeVerifier>["verifier"] | null, name: string, phone: string, password: string) {
  const prep = await prepareRegistration({ name, phone, password });
  if (!prep.ok) throw new Error("invalid registration");
  return startChallenge(p.db, verifier, { purpose: "REGISTER", phone: prep.phone, userId: null, locale: "en", pending: prep.pending });
}

describe("phone normalization", () => {
  it("normalizes Iraqi mobile formats (including Arabic digits) to one canonical E.164 value", async () => {
    for (const input of ["0770 123 4567", "+964 770 123 4567", "009647701234567", "٠٧٧٠١٢٣٤٥٦٧", "770-123-4567"]) {
      const r = await prepareRegistration({ name: "Sara", phone: input, password: "longenough" });
      expect(r.ok && r.phone).toBe("+9647701234567");
    }
    expect((await prepareRegistration({ name: "Sara", phone: "0612345678", password: "longenough" })).ok).toBe(false);
    expect((await prepareRegistration({ name: "Sara", phone: "07701234567", password: "short" })).ok).toBe(false);
  });
});

describe("registration requires phone verification", () => {
  it("stays inactive without an SMS provider: nothing is sent and no account is created", async () => {
    const r = await beginRegistration(null, "NoProvider", "07500000001", "longenough");
    expect(r).toEqual({ ok: false, error: "verification_unavailable" });
    expect(await p.db.$count(users, eq(users.phone, "+9647500000001"))).toBe(0);
    expect(await checkCode(p.db, null, "x".repeat(43), "123456")).toEqual({ ok: false, error: "verification_unavailable" });
  });

  it("creates the account only after the provider approves the code, and stores no code", async () => {
    const sms = fakeVerifier("424242");
    const started = await beginRegistration(sms.verifier, "Zahra", "0750 000 0002", "longenough");
    if (!started.ok) throw new Error(started.error);
    expect(sms.sent).toEqual(["+9647500000002"]);
    expect(await p.db.$count(users, eq(users.phone, "+9647500000002"))).toBe(0);
    // Only hashes and metadata are stored: the raw challenge token and the code never are.
    const [row] = await p.db.select().from(phoneVerifications).where(eq(phoneVerifications.phone, "+9647500000002"));
    expect(JSON.stringify(row)).not.toContain("424242");
    expect(row.id).not.toBe(started.token);
    expect(row.pendingPasswordHash).toMatch(/^pbkdf2/);

    expect(await checkCode(p.db, sms.verifier, started.token, "111111")).toEqual({ ok: false, error: "invalid_code" });
    const ok = await checkCode(p.db, sms.verifier, started.token, "424242");
    expect(ok).toMatchObject({ ok: true, outcome: "verified" });
    const [user] = await p.db.select().from(users).where(eq(users.phone, "+9647500000002"));
    expect(user.phoneVerifiedAt).not.toBeNull();
    expect((await authenticateCustomer(p.db, { phone: "07500000002", password: "longenough" })).ok).toBe(true);
    // The challenge cannot be reused.
    expect(await checkCode(p.db, sms.verifier, started.token, "424242")).toEqual({ ok: false, error: "expired" });
  });

  it("caps wrong-code attempts per challenge", async () => {
    const sms = fakeVerifier("999999");
    const started = await beginRegistration(sms.verifier, "Brute", "07500000003", "longenough");
    if (!started.ok) throw new Error();
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) expect(await checkCode(p.db, sms.verifier, started.token, String(100000 + i))).toMatchObject({ ok: false });
    expect(await checkCode(p.db, sms.verifier, started.token, "999999")).toMatchObject({ ok: false });
    expect(await p.db.$count(users, eq(users.phone, "+9647500000003"))).toBe(0);
  });

  it("does not reveal or alter an existing verified account (no enumeration, no takeover)", async () => {
    const [existing] = await p.db
      .insert(users)
      .values({ phone: "+9647500000004", name: "Owner Of Number", passwordHash: await hashPassword("original-pass"), phoneVerifiedAt: new Date() })
      .returning();
    const sms = fakeVerifier("555555");
    const fresh = await beginRegistration(sms.verifier, "Someone", "07500000099", "attacker-pass");
    const dup = await beginRegistration(sms.verifier, "Attacker", "07500000004", "attacker-pass");
    // Same response shape for a new and an already-registered number.
    expect(Object.keys(fresh).sort()).toEqual(Object.keys(dup).sort());
    expect(fresh.ok).toBe(dup.ok);
    if (!dup.ok) throw new Error();
    // Only the real phone holder can enter the code; doing so changes nothing.
    expect(await checkCode(p.db, sms.verifier, dup.token, "555555")).toEqual({ ok: true, outcome: "already_registered" });
    const [after] = await p.db.select().from(users).where(eq(users.id, existing.id));
    expect(after.name).toBe("Owner Of Number");
    expect((await authenticateCustomer(p.db, { phone: "07500000004", password: "original-pass" })).ok).toBe(true);
    expect((await authenticateCustomer(p.db, { phone: "07500000004", password: "attacker-pass" })).ok).toBe(false);
  });

  it("a second registration for the same pending number cannot overwrite the first person's password", async () => {
    const sms = fakeVerifier("777777");
    const victim = await beginRegistration(sms.verifier, "Victim", "07500000005", "victim-pass");
    const attacker = await beginRegistration(sms.verifier, "Attacker", "07500000005", "attacker-pass");
    if (!victim.ok || !attacker.ok) throw new Error();
    // The SMS goes to the victim's phone; the victim completes their own challenge.
    expect(await checkCode(p.db, sms.verifier, victim.token, "777777")).toMatchObject({ ok: true, outcome: "verified" });
    expect((await authenticateCustomer(p.db, { phone: "07500000005", password: "victim-pass" })).ok).toBe(true);
    expect((await authenticateCustomer(p.db, { phone: "07500000005", password: "attacker-pass" })).ok).toBe(false);
  });

  it("enforces a resend cooldown and a per-challenge send limit", async () => {
    const sms = fakeVerifier();
    const started = await beginRegistration(sms.verifier, "Resend", "07500000006", "longenough");
    const t0 = Date.now() + 1_000;
    if (!started.ok) throw new Error();
    expect(await resendCode(p.db, sms.verifier, started.token, "en", t0)).toEqual({ ok: false, error: "resend_wait" });
    expect(await resendCode(p.db, sms.verifier, started.token, "en", t0 + RESEND_COOLDOWN_MS + 1)).toEqual({ ok: true });
    expect(await resendCode(p.db, sms.verifier, started.token, "en", t0 + 2 * RESEND_COOLDOWN_MS + 2)).toEqual({ ok: true });
    expect(await resendCode(p.db, sms.verifier, started.token, "en", t0 + 3 * RESEND_COOLDOWN_MS + 3)).toEqual({ ok: false, error: "too_many_sends" });
    expect(sms.sent.length).toBe(3);
  });
});

describe("sign-in requires a verified phone", () => {
  it("never issues or honours a session for an unverified account", async () => {
    const [legacy] = await p.db.insert(users).values({ phone: "+9647500000007", name: "Legacy", passwordHash: await hashPassword("legacy-pass") }).returning();
    const right = await authenticateCustomer(p.db, { phone: "07500000007", password: "legacy-pass" });
    expect(right).toMatchObject({ ok: false, error: "phone_unverified" });
    // A wrong password gets the generic error, exactly like an unknown number.
    const wrong = await authenticateCustomer(p.db, { phone: "07500000007", password: "nope-nope" });
    const unknown = await authenticateCustomer(p.db, { phone: "07500000777", password: "nope-nope" });
    expect(wrong).toEqual(unknown);
    const { token } = await createCustomerSession(p.db, legacy.id);
    expect(await validateCustomerSession(p.db, token)).toBeNull();

    const sms = fakeVerifier("313131");
    const started = await startChallenge(p.db, sms.verifier, { purpose: "LOGIN", phone: legacy.phone, userId: legacy.id, locale: "en" });
    if (!started.ok) throw new Error();
    expect(await checkCode(p.db, sms.verifier, started.token, "313131")).toEqual({ ok: true, outcome: "verified", userId: legacy.id });
    expect(await validateCustomerSession(p.db, token)).not.toBeNull();
  });
});

describe("SMS password recovery", () => {
  it("answers identically for unknown numbers, sends nothing to them, and never accepts a code", async () => {
    const sms = fakeVerifier("888888");
    const found = await findUserIdForRecovery(p.db, "07500000555");
    expect(found).toEqual({ ok: true, phone: "+9647500000555", userId: null });
    const started = await startChallenge(p.db, sms.verifier, { purpose: "RESET", phone: "+9647500000555", userId: null, locale: "en" });
    expect(started.ok).toBe(true);
    expect(sms.sent).toEqual([]);
    if (!started.ok) throw new Error();
    expect(await describeChallenge(p.db, started.token)).toMatchObject({ purpose: "RESET", maskedPhone: "0750 ••• 0555" });
    expect(await checkCode(p.db, sms.verifier, started.token, "888888")).toEqual({ ok: false, error: "invalid_code" });
  });

  it("resets the password only after the code is accepted, revokes sessions, and is single-use", async () => {
    const [u] = await p.db.insert(users).values({ phone: "+9647500000008", name: "Forgetful", passwordHash: await hashPassword("old-password"), phoneVerifiedAt: new Date() }).returning();
    const { token: session } = await createCustomerSession(p.db, u.id);
    const sms = fakeVerifier("246810");
    const found = await findUserIdForRecovery(p.db, "07500000008");
    if (!found.ok) throw new Error();
    const started = await startChallenge(p.db, sms.verifier, { purpose: "RESET", phone: found.phone, userId: found.userId, locale: "en" });
    if (!started.ok) throw new Error();
    // No new password before the code is accepted.
    expect(await completeReset(p.db, started.token, "new-password", customerPasswordSchema)).toEqual({ ok: false, error: "expired" });
    expect(await checkCode(p.db, sms.verifier, started.token, "246810")).toEqual({ ok: true, outcome: "reset_ready" });
    expect(await completeReset(p.db, started.token, "new-password", customerPasswordSchema)).toEqual({ ok: true });
    expect(await completeReset(p.db, started.token, "third-password", customerPasswordSchema)).toEqual({ ok: false, error: "expired" });
    expect(await validateCustomerSession(p.db, session)).toBeNull();
    expect(await p.db.$count(sessions, eq(sessions.userId, u.id))).toBe(0);
    expect((await authenticateCustomer(p.db, { phone: "07500000008", password: "new-password" })).ok).toBe(true);
  });
});
