import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { phoneVerifications, users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { createWhatsAppVerifier, generateOtp } from "@/server/integrations/whatsapp-otp";
import { checkCode, resendCode, startChallenge, type Verifiers } from "@/server/services/phone-verification";
import { isPlainEmail, senderAddress, sendEmail } from "@/server/integrations/resend";
import { startPlatform, type TestPlatform } from "../support/platform";
import { fakeFetch, fakeVerifier, json } from "../support/fakes";

let p: TestPlatform;
const SECRET = "test-app-secret-at-least-32-characters-long";
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

const config = { accessToken: "EAAG-SECRET-TOKEN", phoneNumberId: "1234567890", apiVersion: "v23.0", templateName: "robonest_otp", languages: { ar: "ar", en: "en_US" } };

describe("WhatsApp Cloud API OTP provider (mocked; no real messages)", () => {
  it("sends the approved authentication template with the code in body and button, per locale", async () => {
    const f = fakeFetch(json({ messages: [{ id: "wamid.1" }] }));
    const wa = createWhatsAppVerifier(config, SECRET, f.fetchImpl, () => "482913");
    const res = await wa.start("+9647701234567", "ar");
    expect(res.ok).toBe(true);
    expect(f.calls[0].url).toBe("https://graph.facebook.com/v23.0/1234567890/messages");
    expect((f.calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer EAAG-SECRET-TOKEN");
    const body = JSON.parse(String(f.calls[0].init?.body));
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "9647701234567", type: "template", template: { name: "robonest_otp", language: { code: "ar" } } });
    expect(body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "482913" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482913" }] },
    ]);
    // Only a hash comes back; it is bound to the phone number.
    if (!res.ok) throw new Error();
    expect(res.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.codeHash).not.toContain("482913");
    expect(await wa.check("+9647701234567", "482913", { codeHash: res.codeHash! })).toBe("approved");
    expect(await wa.check("+9647701234567", "482914", { codeHash: res.codeHash! })).toBe("rejected");
    expect(await wa.check("+9647709999999", "482913", { codeHash: res.codeHash! })).toBe("rejected");
    expect(await wa.check("+9647701234567", "482913", { codeHash: null })).toBe("rejected");
    await wa.start("+9647701234567", "en");
    expect(JSON.parse(String(f.calls[1].init?.body)).template.language.code).toBe("en_US");
  });

  it("reports send failures without leaking the token or the code", async () => {
    const f = fakeFetch(new Response('{"error":{"message":"Invalid OAuth access token EAAG-SECRET-TOKEN"}}', { status: 401 }));
    const res = await createWhatsAppVerifier(config, SECRET, f.fetchImpl, () => "111222").start("+9647701234567", "ar");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.detail).not.toContain("EAAG-SECRET-TOKEN");
      expect(res.detail).not.toContain("111222");
    }
  });

  it("generates uniform 6-digit codes", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateOtp()));
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe("verification service with WhatsApp primary and SMS fallback", () => {
  it("stores only the hash, verifies on the sending channel, and invalidates the old code when switching to SMS", async () => {
    const waFetch = fakeFetch(json({ messages: [{ id: "wamid.2" }] }));
    let next = "700001";
    const wa = createWhatsAppVerifier(config, SECRET, waFetch.fetchImpl, () => next);
    const sms = fakeVerifier("909090");
    const set: Verifiers = { primary: wa, byChannel: { WHATSAPP: wa, SMS: sms.verifier } };
    const [u] = await p.db.insert(users).values({ phone: "+9647801112233", name: "WA", passwordHash: await hashPassword("old-password"), phoneVerifiedAt: new Date() }).returning();
    const started = await startChallenge(p.db, set, { purpose: "RESET", phone: u.phone, userId: u.id, locale: "ar" });
    if (!started.ok) throw new Error();
    const [row] = await p.db.select().from(phoneVerifications).where(eq(phoneVerifications.userId, u.id));
    expect(row.channel).toBe("WHATSAPP");
    expect(JSON.stringify(row)).not.toContain("700001");
    expect(sms.sent).toEqual([]);

    // The WhatsApp message did not arrive: the customer asks for SMS instead.
    expect(await resendCode(p.db, set, started.token, "ar", Date.now() + 61_000, "SMS")).toEqual({ ok: true });
    const [after] = await p.db.select().from(phoneVerifications).where(eq(phoneVerifications.userId, u.id));
    expect(after).toMatchObject({ channel: "SMS", codeHash: null });
    expect(sms.sent).toEqual([u.phone]);
    // The old WhatsApp code is no longer accepted; the SMS code is.
    expect(await checkCode(p.db, set, started.token, "700001")).toEqual({ ok: false, error: "invalid_code" });
    expect(await checkCode(p.db, set, started.token, "909090")).toEqual({ ok: true, outcome: "reset_ready" });
    next = "x";
  });

  it("is unavailable rather than permissive when the chosen channel is missing", async () => {
    const sms = fakeVerifier();
    const set: Verifiers = { primary: sms.verifier, byChannel: { SMS: sms.verifier } };
    const [u] = await p.db.insert(users).values({ phone: "+9647801112244", name: "NoWA", passwordHash: await hashPassword("pw-password"), phoneVerifiedAt: new Date() }).returning();
    const started = await startChallenge(p.db, set, { purpose: "RESET", phone: u.phone, userId: u.id, locale: "en" });
    if (!started.ok) throw new Error();
    expect(await resendCode(p.db, set, started.token, "en", Date.now() + 61_000, "WHATSAPP")).toEqual({ ok: false, error: "channel_unavailable" });
  });
});

describe("contact email configuration", () => {
  it("validates the recipient and the separate sender format", () => {
    expect(isPlainEmail("contact@robonest.tech")).toBe(true);
    expect(isPlainEmail("RoboNest <contact@robonest.tech>")).toBe(false);
    expect(senderAddress("RoboNest.3D <no-reply@robonest.tech>")).toBe("no-reply@robonest.tech");
    expect(senderAddress("no-reply@robonest.tech")).toBe("no-reply@robonest.tech");
    expect(senderAddress("not an address")).toBeNull();
    expect(senderAddress("A <b@c.tech>\r\nBcc: x@y.z")).toBeNull();
  });

  it("loads Resend settings from Worker bindings and requires a separate sender", async () => {
    const { contactEmailStatus } = await import("@/server/email-config");
    const env = p.env as unknown as Record<string, string | undefined>;
    Object.assign(env, { RESEND_API_KEY: "re_test_1234567890", CONTACT_FORM_EMAIL: "contact@robonest.tech", CONTACT_FROM_EMAIL: "contact@robonest.tech" });
    const same = await contactEmailStatus();
    expect(same.config).toBeNull();
    expect(same.problems.join(" ")).toMatch(/separate address/);
    // Problems name variables only, never values.
    expect(same.problems.join(" ")).not.toContain("re_test_1234567890");
    env.CONTACT_FROM_EMAIL = "RoboNest.3D <no-reply@robonest.tech>";
    const good = await contactEmailStatus();
    expect(good).toMatchObject({ problems: [], senderDomain: "robonest.tech", config: { to: "contact@robonest.tech", from: "RoboNest.3D <no-reply@robonest.tech>" } });
    // Built Workers (NODE_ENV != development) never fall back to process.env (.env.local copied by OpenNext).
    env.RESEND_API_KEY = undefined;
    process.env.RESEND_API_KEY = "re_from_dotenv_9999999";
    expect((await contactEmailStatus()).problems).toContain("RESEND_API_KEY missing");
    delete process.env.RESEND_API_KEY;
    Object.assign(env, { RESEND_API_KEY: undefined, CONTACT_FORM_EMAIL: undefined, CONTACT_FROM_EMAIL: undefined });
  });

  it("treats a Resend response without an email id as a failure", async () => {
    const f = fakeFetch(json({}));
    expect(await sendEmail({ apiKey: "re_x_1234567", from: "a@robonest.tech", to: "contact@robonest.tech" }, { subject: "s", text: "t" }, f.fetchImpl)).toMatchObject({ ok: false });
    const ok = fakeFetch(json({ id: "email_123" }));
    expect(await sendEmail({ apiKey: "re_x_1234567", from: "a@robonest.tech", to: "contact@robonest.tech" }, { subject: "s", text: "t" }, ok.fetchImpl)).toEqual({ ok: true, id: "email_123" });
  });
});
