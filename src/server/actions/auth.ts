"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getLocale } from "next-intl/server";
import {
  clearCustomerSessionCookie,
  clearVerifyCookie,
  readVerifyCookie,
  setVerifyCookie,
  getCurrentUser,
  getVisitorHash,
  readCustomerSessionToken,
  setCustomerSessionCookie,
} from "@/server/auth/current";
import { createCustomerSession, deleteCustomerSession } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { getRequestMeta } from "@/server/request-meta";
import { mergeVisitorCart } from "@/server/services/cart";
import {
  authenticateCustomer,
  changeCustomerPassword,
  customerPasswordSchema,
  findUserIdForRecovery,
  prepareRegistration,
  resetPasswordWithToken,
  updateCustomerProfile,
} from "@/server/services/customer-auth";
import { checkCode, completeReset, resendCode, startChallenge, type StartInput } from "@/server/services/phone-verification";
import { getPhoneVerifiers } from "@/server/sms";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { normalizeIraqiPhone } from "@/lib/phone";
import { safeRedirectPath } from "@/lib/safe-redirect";

export type FormState = { error?: string; fields?: Record<string, string>; success?: boolean; values?: Record<string, string> } | null;

async function startSession(userId: string) {
  const db = await getDb();
  const meta = await getRequestMeta();
  // Session fixation defence: always issue a brand-new token at sign-in.
  const previous = await readCustomerSessionToken();
  if (previous) await deleteCustomerSession(db, previous);
  const { token, expiresAt } = await createCustomerSession(db, userId, meta);
  await setCustomerSessionCookie(token, expiresAt);
  const visitor = await getVisitorHash();
  if (visitor) await mergeVisitorCart(db, visitor, userId);
}

function nextPath(formData: FormData, locale: string) {
  const raw = safeRedirectPath(formData.get("next"), "/account");
  // Accept both "/checkout" and "/en/checkout".
  return /^\/(ar|en)(\/|$)/.test(raw) ? raw : `/${locale}${raw}`;
}

/** Sends an SMS challenge (rate-limited per number and per IP) and stores its token in a cookie. */
async function beginVerification(input: Omit<StartInput, "ipHash" | "locale">): Promise<string | null> {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  const verifier = await getPhoneVerifiers();
  if (!verifier) return "verification_unavailable";
  if (!(await consumeRateLimit(db, "smsSendIp", ipHash)) || !(await consumeRateLimit(db, "smsSendPhone", input.phone))) return "rate_limited";
  const started = await startChallenge(db, verifier, { ...input, ipHash, locale: await getLocale() });
  if (!started.ok) return started.error;
  await setVerifyCookie(started.token);
  return null;
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const phone = String(formData.get("phone") ?? "").slice(0, 30);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  const normalized = normalizeIraqiPhone(phone) ?? "invalid";
  const allowed = (await consumeRateLimit(db, "customerLogin", ipHash)) && (await consumeRateLimit(db, "customerLoginPhone", normalized));
  if (!allowed) return { error: "rate_limited", values: { phone } };
  const result = await authenticateCustomer(db, { phone, password });
  const locale = await getLocale();
  if (!result.ok && result.error === "phone_unverified") {
    // Only reachable with the correct password, so it reveals nothing new.
    const error = await beginVerification({ purpose: "LOGIN", phone: result.phone, userId: result.userId });
    if (error) return { error, values: { phone } };
    redirect(`/${locale}/verify-phone?next=${encodeURIComponent(nextPath(formData, locale))}`);
  }
  if (!result.ok) return { error: result.error, values: { phone } };
  await startSession(result.user.id);
  redirect(nextPath(formData, locale));
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { name: String(formData.get("name") ?? "").slice(0, 100), phone: String(formData.get("phone") ?? "").slice(0, 30) };
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "register", ipHash))) return { error: "rate_limited", values };
  const locale = await getLocale();
  const result = await prepareRegistration({ ...values, password: String(formData.get("password") ?? "").slice(0, 200) });
  if (!result.ok) {
    const fields: Record<string, string> = {};
    for (const issue of result.issues) {
      if (issue === "invalid_phone") fields.phone = issue;
      else if (issue.startsWith("password")) fields.password = issue;
      else if (issue.includes("name")) fields.name = issue;
    }
    return { error: result.error, fields, values };
  }
  // Identical path for new and already-registered numbers (no enumeration).
  const error = await beginVerification({ purpose: "REGISTER", phone: result.phone, userId: null, pending: result.pending });
  if (error) return { error, values };
  redirect(`/${locale}/verify-phone?next=${encodeURIComponent(nextPath(formData, locale))}`);
}

export async function verifyPhoneAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "smsCheckIp", ipHash))) return { error: "rate_limited" };
  const locale = await getLocale();
  const result = await checkCode(db, await getPhoneVerifiers(), await readVerifyCookie(), formData.get("code"), Date.now(), locale);
  if (!result.ok) {
    if (result.error === "expired" || result.error === "too_many_attempts") await clearVerifyCookie();
    return { error: result.error };
  }
  if (result.outcome === "reset_ready") {
    refresh();
    return { success: true };
  }
  await clearVerifyCookie();
  if (result.outcome === "already_registered") return { error: "already_registered" };
  await startSession(result.userId);
  redirect(nextPath(formData, locale));
}

export async function resendCodeAction(_prev: FormState, formData?: FormData): Promise<FormState> {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "smsSendIp", ipHash))) return { error: "rate_limited" };
  // "Send by SMS instead": fallback when a WhatsApp code does not arrive.
  const channel = formData?.get("channel") === "SMS" ? "SMS" : undefined;
  const res = await resendCode(db, await getPhoneVerifiers(), await readVerifyCookie(), await getLocale(), Date.now(), channel);
  return res.ok ? { success: true } : { error: res.error };
}

/** Step 1 of SMS recovery. Same answer for registered and unknown numbers. */
export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "passwordReset", ipHash))) return { error: "rate_limited" };
  const found = await findUserIdForRecovery(db, String(formData.get("phone") ?? "").slice(0, 30));
  if (!found.ok) return { error: "invalid_phone", fields: { phone: "invalid_phone" } };
  const error = await beginVerification({ purpose: "RESET", phone: found.phone, userId: found.userId });
  if (error) return { error };
  refresh();
  return { success: true };
}

/** Step 3 of SMS recovery: only after the code was accepted. */
export async function resetWithCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "passwordReset", ipHash))) return { error: "rate_limited" };
  const res = await completeReset(db, await readVerifyCookie(), String(formData.get("password") ?? "").slice(0, 200), customerPasswordSchema);
  if (!res.ok) return { error: res.error };
  await clearVerifyCookie();
  return { success: true };
}

export async function cancelVerificationAction(): Promise<void> {
  await clearVerifyCookie();
  refresh();
}

export async function logoutAction(): Promise<void> {
  const token = await readCustomerSessionToken();
  if (token) await deleteCustomerSession(await getDb(), token);
  await clearCustomerSessionCookie();
  redirect(`/${await getLocale()}`);
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "passwordReset", ipHash))) return { error: "rate_limited" };
  const result = await resetPasswordWithToken(db, String(formData.get("token") ?? ""), String(formData.get("password") ?? "").slice(0, 200));
  if (!result.ok) return { error: result.error };
  return { success: true };
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };
  const db = await getDb();
  if (!(await consumeRateLimit(db, "passwordChange", user.id))) return { error: "rate_limited" };
  const result = await changeCustomerPassword(db, user.id, String(formData.get("current") ?? ""), String(formData.get("next") ?? ""));
  if (!result.ok) return { error: result.error };
  // All sessions were revoked; sign this device back in with a fresh token.
  await startSession(user.id);
  return { success: true };
}

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };
  const result = await updateCustomerProfile(await getDb(), user.id, { name: formData.get("name"), locale: formData.get("locale") });
  if (!result.ok) return { error: result.error };
  refresh();
  return { success: true };
}
