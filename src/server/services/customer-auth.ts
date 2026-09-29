import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type Database } from "@/server/db/client";
import { passwordResetTokens, sessions, users } from "@/server/db/schema";
import { randomToken, sha256Hex } from "@/server/auth/crypto";
import { getDummyHash, hashPassword, verifyPassword } from "@/server/auth/password";
import { normalizeIraqiPhone } from "@/lib/phone";

export const CUSTOMER_PASSWORD_MIN = 8;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const phoneField = z.string().trim().max(24).transform((v, ctx) => {
  const phone = normalizeIraqiPhone(v);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "invalid_phone" });
    return z.NEVER;
  }
  return phone;
});
const passwordField = z.string().min(CUSTOMER_PASSWORD_MIN, "password_too_short").max(128, "password_too_long");
const nameField = z
  .string()
  .trim()
  .min(2, "name_required")
  .max(80)
  .refine((s) => !/[\u0000-\u001F\u007F<>]/.test(s), "invalid_name");

export const registerSchema = z.object({ name: nameField, phone: phoneField, password: passwordField });
export const loginSchema = z.object({ phone: phoneField, password: z.string().min(1).max(128) });

export async function registerCustomer(db: Database, raw: unknown, locale: string) {
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" as const, issues: parsed.error.issues.map((i) => i.message) };
  const { name, phone, password } = parsed.data;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
  if (existing) return { ok: false as const, error: "phone_taken" as const, issues: [] };
  try {
    const [user] = await db
      .insert(users)
      .values({ name, phone, passwordHash: await hashPassword(password), locale: locale === "en" ? "en" : "ar" })
      .returning({ id: users.id });
    return { ok: true as const, userId: user.id };
  } catch {
    // Unique index race: another request registered the same phone first.
    return { ok: false as const, error: "phone_taken" as const, issues: [] };
  }
}

/** Same error and similar timing for unknown phone, wrong password or disabled account. */
export async function authenticateCustomer(db: Database, raw: unknown) {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_credentials" as const };
  const [user] = await db.select().from(users).where(eq(users.phone, parsed.data.phone)).limit(1);
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !valid || user.status !== "ACTIVE") return { ok: false as const, error: "invalid_credentials" as const };
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return { ok: true as const, user: { id: user.id, name: user.name, phone: user.phone } };
}

export async function changeCustomerPassword(db: Database, userId: string, current: string, next: string) {
  const parsedNext = passwordField.safeParse(next);
  if (!parsedNext.success) return { ok: false as const, error: "password_too_short" as const };
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !(await verifyPassword(current, user.passwordHash))) return { ok: false as const, error: "wrong_password" as const };
  await runBatch(db, [
    db.update(users).set({ passwordHash: await hashPassword(parsedNext.data) }).where(eq(users.id, userId)),
    // Sign out every other device; the caller issues a fresh session.
    db.delete(sessions).where(eq(sessions.userId, userId)),
  ]);
  return { ok: true as const };
}

export async function updateCustomerProfile(db: Database, userId: string, raw: unknown) {
  const parsed = z.object({ name: nameField, locale: z.enum(["ar", "en"]) }).safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" as const };
  await db.update(users).set(parsed.data).where(eq(users.id, userId));
  return { ok: true as const };
}

/**
 * Admin-assisted recovery (no SMS provider): staff verify the customer by
 * phone/WhatsApp, then generate a one-time link valid for one hour.
 */
export async function createPasswordResetToken(db: Database, userId: string, adminId: string, now = Date.now()) {
  const token = randomToken();
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date(now) })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
  await db.insert(passwordResetTokens).values({
    id: await sha256Hex(token),
    userId,
    createdByAdminId: adminId,
    expiresAt: new Date(now + RESET_TOKEN_TTL_MS),
  });
  return token;
}

export async function resetPasswordWithToken(db: Database, token: string, newPassword: string, now = Date.now()) {
  const parsed = passwordField.safeParse(newPassword);
  if (!parsed.success) return { ok: false as const, error: "password_too_short" as const };
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false as const, error: "invalid_token" as const };
  const id = await sha256Hex(token);
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.id, id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date(now))))
    .limit(1);
  if (!row) return { ok: false as const, error: "invalid_token" as const };
  await runBatch(db, [
    db.update(passwordResetTokens).set({ usedAt: new Date(now) }).where(eq(passwordResetTokens.id, id)),
    db.update(users).set({ passwordHash: await hashPassword(parsed.data) }).where(eq(users.id, row.userId)),
    db.delete(sessions).where(eq(sessions.userId, row.userId)),
  ]);
  return { ok: true as const };
}

export async function isResetTokenValid(db: Database, token: string, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [row] = await db
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.id, await sha256Hex(token)), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date(now))))
    .limit(1);
  return Boolean(row);
}
