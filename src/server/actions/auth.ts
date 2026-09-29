"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getLocale } from "next-intl/server";
import {
  clearCustomerSessionCookie,
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
  registerCustomer,
  resetPasswordWithToken,
  updateCustomerProfile,
} from "@/server/services/customer-auth";
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

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const phone = String(formData.get("phone") ?? "").slice(0, 30);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  const normalized = normalizeIraqiPhone(phone) ?? "invalid";
  const allowed = (await consumeRateLimit(db, "customerLogin", ipHash)) && (await consumeRateLimit(db, "customerLoginPhone", normalized));
  if (!allowed) return { error: "rate_limited", values: { phone } };
  const result = await authenticateCustomer(db, { phone, password });
  if (!result.ok) return { error: result.error, values: { phone } };
  await startSession(result.user.id);
  redirect(nextPath(formData, await getLocale()));
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { name: String(formData.get("name") ?? "").slice(0, 100), phone: String(formData.get("phone") ?? "").slice(0, 30) };
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "register", ipHash))) return { error: "rate_limited", values };
  const locale = await getLocale();
  const result = await registerCustomer(db, { ...values, password: String(formData.get("password") ?? "").slice(0, 200) }, locale);
  if (!result.ok) {
    const fields: Record<string, string> = {};
    for (const issue of result.issues) {
      if (issue === "invalid_phone") fields.phone = issue;
      else if (issue.startsWith("password")) fields.password = issue;
      else if (issue.includes("name")) fields.name = issue;
    }
    if (result.error === "phone_taken") fields.phone = "phone_taken";
    return { error: result.error, fields, values };
  }
  await startSession(result.userId);
  redirect(nextPath(formData, locale));
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
