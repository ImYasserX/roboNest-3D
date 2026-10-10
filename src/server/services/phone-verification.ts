import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type Database } from "@/server/db/client";
import { phoneVerifications, sessions, users } from "@/server/db/schema";
import { randomToken, sha256Hex } from "@/server/auth/crypto";
import { hashPassword } from "@/server/auth/password";
import type { PhoneVerifier, VerificationChannel } from "@/server/integrations/twilio-verify";

/** The configured channels: `primary` sends first; `byChannel` checks codes on the channel they were sent on. */
export type Verifiers = { primary: PhoneVerifier; byChannel: Partial<Record<VerificationChannel, PhoneVerifier>> };
type VerifierInput = PhoneVerifier | Verifiers | null;

function asVerifiers(v: VerifierInput): Verifiers | null {
  if (!v) return null;
  if ("primary" in v) return v;
  return { primary: v, byChannel: { [v.channel]: v } };
}
import type { PhoneVerificationPurpose } from "@/lib/domain";

// Phone-number verification and SMS-based password recovery.
//
// - A challenge row binds (purpose, phone, user) to a random token held in an
//   HttpOnly cookie. Only SHA-256(token) is stored.
// - The SMS provider generates and checks the code; this app never sees,
//   stores or logs it.
// - Responses never reveal whether a phone number has an account: the same
//   screens appear for registered and unregistered numbers.
// - Without a configured provider (`verifier === null`) nothing is sent and no
//   account can be verified, so unverified numbers are never accepted.

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_SENDS_PER_CHALLENGE = 3;
export const RESEND_COOLDOWN_MS = 60 * 1000;
/** After the code is accepted on a reset challenge, the new password must be set within this window. */
export const RESET_WINDOW_MS = 10 * 60 * 1000;

export const codeSchema = z.string().trim().regex(/^\d{4,10}$/);

export type StartResult = { ok: true; token: string } | { ok: false; error: "verification_unavailable" | "send_failed" };

export type StartInput = {
  purpose: PhoneVerificationPurpose;
  phone: string;
  /** LOGIN/RESET: the account (null on RESET = unknown number, no SMS is sent). */
  userId: string | null;
  locale: string;
  ipHash?: string | null;
  /** REGISTER only. */
  pending?: { name: string; passwordHash: string };
};

/** Creates a challenge and sends the code (except for RESET on a number with no account). */
export async function startChallenge(db: Database, verifiers: VerifierInput, input: StartInput, now = Date.now()): Promise<StartResult> {
  const set = asVerifiers(verifiers);
  if (!set) return { ok: false, error: "verification_unavailable" };
  const verifier = set.primary;
  let codeHash: string | null = null;
  const token = randomToken();
  if (challengeSendsSms(input.purpose, input.userId)) {
    const sent = await verifier.start(input.phone, input.locale);
    if (!sent.ok) {
      console.error("phone verification start failed", { channel: verifier.channel, purpose: input.purpose, detail: sent.detail });
      return { ok: false, error: "send_failed" };
    }
    codeHash = sent.codeHash ?? null;
  }
  await db.insert(phoneVerifications).values({
    id: await sha256Hex(token),
    purpose: input.purpose,
    phone: input.phone,
    userId: input.userId,
    pendingName: input.pending?.name ?? null,
    pendingPasswordHash: input.pending?.passwordHash ?? null,
    channel: verifier.channel,
    codeHash,
    lastSentAt: new Date(now),
    expiresAt: new Date(now + CHALLENGE_TTL_MS),
    ipHash: input.ipHash ?? null,
    createdAt: new Date(now),
  });
  return { ok: true, token };
}

function challengeSendsSms(purpose: PhoneVerificationPurpose, userId: string | null) {
  return purpose === "REGISTER" || userId !== null;
}

async function loadChallenge(db: Database, token: string | null | undefined, now: number) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db
    .select()
    .from(phoneVerifications)
    .where(and(eq(phoneVerifications.id, await sha256Hex(token)), isNull(phoneVerifications.consumedAt), gt(phoneVerifications.expiresAt, new Date(now))))
    .limit(1);
  return row ?? null;
}

/** Public facts about a pending challenge for the verification screen (masked phone only). */
export async function describeChallenge(db: Database, token: string | null | undefined, now = Date.now()) {
  const row = await loadChallenge(db, token, now);
  if (!row) return null;
  return { purpose: row.purpose, channel: row.channel, maskedPhone: maskPhone(row.phone), codeAccepted: Boolean(row.verifiedAt), canResendAt: (row.lastSentAt?.getTime() ?? 0) + RESEND_COOLDOWN_MS };
}

/** +9647701234567 → 0770 ••• 4567 */
export function maskPhone(e164: string) {
  const local = e164.startsWith("+964") ? `0${e164.slice(4)}` : e164;
  return `${local.slice(0, 4)} ••• ${local.slice(-4)}`;
}

/**
 * Sends a new code. `channel` switches channel (e.g. "send by SMS instead"
 * when a WhatsApp message did not arrive); the new code replaces the old one.
 */
export async function resendCode(db: Database, verifiers: VerifierInput, token: string | null | undefined, locale: string, now = Date.now(), channel?: VerificationChannel) {
  const set = asVerifiers(verifiers);
  if (!set) return { ok: false as const, error: "verification_unavailable" as const };
  const verifier = channel ? set.byChannel[channel] : set.primary;
  if (!verifier) return { ok: false as const, error: "channel_unavailable" as const };
  const row = await loadChallenge(db, token, now);
  if (!row || row.verifiedAt) return { ok: false as const, error: "expired" as const };
  if (row.sendCount >= MAX_SENDS_PER_CHALLENGE) return { ok: false as const, error: "too_many_sends" as const };
  if (row.lastSentAt && now - row.lastSentAt.getTime() < RESEND_COOLDOWN_MS) return { ok: false as const, error: "resend_wait" as const };
  // Claim the send slot first so parallel requests cannot multiply SMS.
  const claimed = await db
    .update(phoneVerifications)
    .set({ sendCount: sql`${phoneVerifications.sendCount} + 1`, lastSentAt: new Date(now), expiresAt: new Date(now + CHALLENGE_TTL_MS) })
    .where(and(eq(phoneVerifications.id, row.id), eq(phoneVerifications.sendCount, row.sendCount)))
    .returning({ id: phoneVerifications.id });
  if (claimed.length !== 1) return { ok: false as const, error: "resend_wait" as const };
  let codeHash: string | null = null;
  if (challengeSendsSms(row.purpose, row.userId)) {
    const sent = await verifier.start(row.phone, locale);
    if (!sent.ok) return { ok: false as const, error: "send_failed" as const };
    codeHash = sent.codeHash ?? null;
  }
  await db.update(phoneVerifications).set({ channel: verifier.channel, codeHash }).where(eq(phoneVerifications.id, row.id));
  return { ok: true as const };
}

export type CheckResult =
  | { ok: true; outcome: "verified"; userId: string }
  | { ok: true; outcome: "already_registered" }
  | { ok: true; outcome: "reset_ready" }
  | { ok: false; error: "verification_unavailable" | "expired" | "invalid_code" | "too_many_attempts" | "provider_error" };

/**
 * Checks a code. Every attempt is counted before the provider is called, so
 * the attempt cap holds even under parallel requests.
 */
export async function checkCode(db: Database, verifiers: VerifierInput, token: string | null | undefined, rawCode: unknown, now = Date.now(), locale = "ar"): Promise<CheckResult> {
  const set = asVerifiers(verifiers);
  if (!set) return { ok: false, error: "verification_unavailable" };
  const row = await loadChallenge(db, token, now);
  if (!row || row.verifiedAt) return { ok: false, error: "expired" };
  const code = codeSchema.safeParse(rawCode);
  const [counted] = await db
    .update(phoneVerifications)
    .set({ attempts: sql`${phoneVerifications.attempts} + 1` })
    .where(eq(phoneVerifications.id, row.id))
    .returning({ attempts: phoneVerifications.attempts });
  if ((counted?.attempts ?? MAX_CODE_ATTEMPTS + 1) > MAX_CODE_ATTEMPTS) {
    await db.update(phoneVerifications).set({ consumedAt: new Date(now) }).where(eq(phoneVerifications.id, row.id));
    return { ok: false, error: "too_many_attempts" };
  }
  if (!code.success) return { ok: false, error: "invalid_code" };
  // Unknown number on a reset: no SMS was sent, so no code can be right.
  if (!challengeSendsSms(row.purpose, row.userId)) return { ok: false, error: "invalid_code" };

  // Check on the channel that sent the latest code.
  const verifier = set.byChannel[row.channel];
  if (!verifier) return { ok: false, error: "verification_unavailable" };
  const verdict = await verifier.check(row.phone, code.data, { codeHash: row.codeHash });
  if (verdict === "error") return { ok: false, error: "provider_error" };
  if (verdict !== "approved") return { ok: false, error: "invalid_code" };
  const at = new Date(now);

  if (row.purpose === "REGISTER") {
    const [existing] = await db.select({ id: users.id, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.phone, row.phone)).limit(1);
    await db.update(phoneVerifications).set({ consumedAt: at, verifiedAt: at }).where(eq(phoneVerifications.id, row.id));
    // Already a verified account: change nothing, sign nobody in. Only the
    // person holding the phone learns this, by entering the code.
    if (existing?.phoneVerifiedAt) return { ok: true, outcome: "already_registered" };
    if (!row.pendingName || !row.pendingPasswordHash) return { ok: false, error: "expired" };
    if (existing) {
      // Legacy unverified account (created before verification existed).
      await db.update(users).set({ name: row.pendingName, passwordHash: row.pendingPasswordHash, phoneVerifiedAt: at }).where(eq(users.id, existing.id));
      return { ok: true, outcome: "verified", userId: existing.id };
    }
    try {
      const [created] = await db
        .insert(users)
        .values({ phone: row.phone, name: row.pendingName, passwordHash: row.pendingPasswordHash, phoneVerifiedAt: at, locale: locale === "en" ? "en" : "ar" })
        .returning({ id: users.id });
      return { ok: true, outcome: "verified", userId: created.id };
    } catch {
      // Unique phone race: another challenge for this number won.
      return { ok: true, outcome: "already_registered" };
    }
  }

  const [user] = await db.select({ id: users.id, phone: users.phone, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, row.userId!)).limit(1);
  if (!user || user.phone !== row.phone) return { ok: false, error: "expired" };
  if (row.purpose === "RESET") {
    await db.update(phoneVerifications).set({ verifiedAt: at, expiresAt: new Date(now + RESET_WINDOW_MS) }).where(eq(phoneVerifications.id, row.id));
    return { ok: true, outcome: "reset_ready" };
  }
  // LOGIN: the password was already checked when this challenge was created.
  await runBatch(db, [
    db.update(phoneVerifications).set({ consumedAt: at, verifiedAt: at }).where(eq(phoneVerifications.id, row.id)),
    ...(user.phoneVerifiedAt ? [] : [db.update(users).set({ phoneVerifiedAt: at }).where(eq(users.id, user.id))]),
  ]);
  return { ok: true, outcome: "verified", userId: user.id };
}

/** Final reset step: only after the code was accepted on this RESET challenge. Revokes all sessions. */
export async function completeReset(db: Database, token: string | null | undefined, newPassword: string, passwordSchema: z.ZodType<string>, now = Date.now()) {
  const parsed = passwordSchema.safeParse(newPassword);
  if (!parsed.success) return { ok: false as const, error: "password_too_short" as const };
  const row = await loadChallenge(db, token, now);
  if (!row || row.purpose !== "RESET" || !row.verifiedAt || !row.userId) return { ok: false as const, error: "expired" as const };
  const claimed = await db
    .update(phoneVerifications)
    .set({ consumedAt: new Date(now) })
    .where(and(eq(phoneVerifications.id, row.id), isNull(phoneVerifications.consumedAt)))
    .returning({ id: phoneVerifications.id });
  if (claimed.length !== 1) return { ok: false as const, error: "expired" as const };
  await runBatch(db, [
    // Proving control of the number also verifies it.
    db.update(users).set({ passwordHash: await hashPassword(parsed.data), phoneVerifiedAt: sql`COALESCE(${users.phoneVerifiedAt}, ${now})` }).where(eq(users.id, row.userId)),
    db.delete(sessions).where(eq(sessions.userId, row.userId)),
  ]);
  return { ok: true as const };
}
