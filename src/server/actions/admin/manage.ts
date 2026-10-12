"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { formObject, withAdmin } from "@/server/admin-action";
import { getSiteUrl } from "@/server/env";
import { createAdminUser, resetAdminTotp, setAdminPasswordBySuperAdmin, updateAdminUser } from "@/server/services/admin-auth";
import { deleteCategory, saveCategory } from "@/server/services/categories";
import { reviewCustomRequest } from "@/server/services/custom-print";
import { createPasswordResetToken } from "@/server/services/customer-auth";
import { deleteCustomer, updateCustomer } from "@/server/services/customers";
import { deleteArea, saveArea, updateZone } from "@/server/services/delivery";
import { saveDiscount } from "@/server/services/discounts";
import { setContactStatus } from "@/server/services/engagement";
import { getSetting, saveSetting } from "@/server/services/settings";
import { writeAudit } from "@/server/services/audit";
import { createTestNotification, dispatchNotification, retryNotification } from "@/server/services/notifications";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { getNotifierConfig } from "@/server/notify";
import { contactEmailStatus } from "@/server/email-config";
import { sendEmail } from "@/server/integrations/resend";
import { DEPOSIT_METHODS } from "@/lib/domain";

type State = { ok?: boolean; error?: string; message?: string } | null;
const uuid = z.string().uuid();
const optionalId = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" && v ? uuid.safeParse(v) : null;
  return s === null ? { ok: true as const, id: null } : s.success ? { ok: true as const, id: s.data } : { ok: false as const, id: null };
};
const done = (res: { ok: boolean; error?: string }): State => {
  if (!res.ok) return { error: res.error ?? "invalid_input" };
  refresh();
  return { ok: true };
};

// Categories ------------------------------------------------------------------

export async function saveCategoryAction(_prev: State, formData: FormData): Promise<State> {
  const id = optionalId(formData.get("id"));
  if (!id.ok) return { error: "invalid_input" };
  const data = { ...formObject(formData), isActive: formData.get("isActive") ? "on" : "" };
  return done(await withAdmin("categories.edit", ({ db, actor }) => saveCategory(db, id.id, data, actor)));
}

export async function deleteCategoryAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "invalid_input" };
  return done(await withAdmin("categories.delete", ({ db, actor }) => deleteCategory(db, id.data, actor)));
}

// Delivery -------------------------------------------------------------------

export async function updateZoneAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "invalid_input" };
  const data = { ...formObject(formData), isActive: formData.get("isActive") ? "on" : "" };
  return done(await withAdmin("delivery.edit", ({ db, actor }) => updateZone(db, id.data, data, actor)));
}

export async function saveAreaAction(_prev: State, formData: FormData): Promise<State> {
  const zoneId = uuid.safeParse(formData.get("zoneId"));
  const areaId = optionalId(formData.get("areaId"));
  if (!zoneId.success || !areaId.ok) return { error: "invalid_input" };
  const data = { ...formObject(formData), isActive: formData.get("isActive") ? "on" : "" };
  return done(await withAdmin("delivery.edit", ({ db, actor }) => saveArea(db, zoneId.data, areaId.id, data, actor)));
}

export async function deleteAreaAction(_prev: State, formData: FormData): Promise<State> {
  const p = z.object({ zoneId: uuid, areaId: uuid }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "invalid_input" };
  return done(await withAdmin("delivery.edit", ({ db, actor }) => deleteArea(db, p.data.zoneId, p.data.areaId, actor)));
}

// Discounts (Super Admin) ------------------------------------------------------

export async function saveDiscountAction(_prev: State, formData: FormData): Promise<State> {
  const id = optionalId(formData.get("id"));
  if (!id.ok) return { error: "invalid_input" };
  const data = { ...formObject(formData), isActive: formData.get("isActive") ? "on" : "" };
  return done(await withAdmin("discounts.manage", ({ db, actor }) => saveDiscount(db, id.id, data, actor)));
}

// Customers ------------------------------------------------------------------

export async function updateCustomerAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "invalid_input" };
  return done(await withAdmin("customers.edit", ({ db, actor }) => updateCustomer(db, id.data, { name: formData.get("name"), status: formData.get("status") }, actor)));
}

export async function createResetLinkAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "invalid_input" };
  const res = await withAdmin("customers.edit", async ({ db, admin, actor }) => {
    const token = await createPasswordResetToken(db, id.data, admin.id);
    const { writeAudit } = await import("@/server/services/audit");
    await writeAudit(db, actor, { action: "customer.passwordReset.created", targetType: "customer", targetId: id.data });
    return { ok: true as const, token };
  });
  if (!res.ok) return { error: res.error };
  const locale = await getLocale();
  // Shown once to the staff member; only its hash is stored.
  return { ok: true, message: `${await getSiteUrl()}/${locale}/reset-password/${res.token}` };
}

export async function deleteCustomerAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "invalid_input" };
  const res = await withAdmin("customers.delete", ({ db, actor }) => deleteCustomer(db, id.data, actor));
  if (!res.ok) return { error: "error" in res ? res.error : "invalid_input" };
  redirect(`/${await getLocale()}/admin/customers?deleted=1`);
}

// Custom print requests -------------------------------------------------------

export async function reviewCustomRequestAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "not_found" };
  return done(await withAdmin("customRequests.manage", ({ db, actor }) => reviewCustomRequest(db, id.data, formObject(formData), actor)));
}

// Content & settings ----------------------------------------------------------

function parseChoices(text: string) {
  return text
    .split("\n")
    .map((l) => l.split("|").map((s) => s.trim()))
    .filter((p) => p[0])
    .map(([code, en, ar]) => ({ code: code.toUpperCase(), en: en ?? "", ar: ar || en || "" }));
}

export async function saveHomepageAction(_prev: State, formData: FormData): Promise<State> {
  const f = formObject(formData);
  const value = {
    announcement: { en: f.announcementEn ?? "", ar: f.announcementAr ?? "" },
    heroTitle: { en: f.heroTitleEn ?? "", ar: f.heroTitleAr ?? "" },
    heroSubtitle: { en: f.heroSubtitleEn ?? "", ar: f.heroSubtitleAr ?? "" },
  };
  return done(await withAdmin("content.edit", ({ db, actor }) => saveSetting(db, "homepage", value, actor)));
}

export async function saveStoreAction(_prev: State, formData: FormData): Promise<State> {
  const f = formObject(formData);
  const value = {
    instagram: f.instagram ?? "",
    facebook: f.facebook ?? "",
    address: { en: f.addressEn ?? "", ar: f.addressAr ?? "" },
  };
  const res = await withAdmin("content.edit", ({ db, actor }) => saveSetting(db, "store", value, actor));
  if (!res.ok && "issues" in res) {
    const issue = res.issues?.[0] ?? "";
    return { error: issue === "instagram" || issue === "facebook" ? "invalid_url" : "invalid_input" };
  }
  return done(res);
}

export async function saveCustomPrintOptionsAction(_prev: State, formData: FormData): Promise<State> {
  const value = { materials: parseChoices(String(formData.get("materials") ?? "")), colors: parseChoices(String(formData.get("colors") ?? "")) };
  return done(await withAdmin("content.edit", ({ db, actor }) => saveSetting(db, "customPrint", value, actor)));
}

export async function saveSecurityAction(_prev: State, formData: FormData): Promise<State> {
  const value = { requireTotpForAllAdmins: formData.get("requireTotpForAllAdmins") === "on" };
  return done(await withAdmin("settings.edit", ({ db, actor }) => saveSetting(db, "security", value, actor)));
}

// Admin users (Super Admin) ---------------------------------------------------

export async function createAdminAction(_prev: State, formData: FormData): Promise<State> {
  return done(await withAdmin("admins.manage", ({ db, actor }) => createAdminUser(db, formObject(formData), actor)));
}

export async function updateAdminAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "invalid_input" };
  return done(await withAdmin("admins.manage", ({ db, actor }) => updateAdminUser(db, id.data, formObject(formData), actor)));
}

export async function setAdminPasswordAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "invalid_input" };
  return done(await withAdmin("admins.manage", ({ db, actor, admin }) => setAdminPasswordBySuperAdmin(db, id.data, String(formData.get("password") ?? ""), actor, admin.role)));
}

export async function resetAdminTotpAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "invalid_input" };
  return done(await withAdmin("admins.manage", ({ db, actor, admin }) => resetAdminTotp(db, id.data, actor, admin.role)));
}

// Messages ---------------------------------------------------------------------

export async function setMessageStatusAction(formData: FormData): Promise<void> {
  const p = z.object({ id: uuid, status: z.string() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return;
  await withAdmin("messages.view", ({ db }) => setContactStatus(db, p.data.id, p.data.status));
  refresh();
}

// Payments / deposits (owners and Super Admins) -------------------------------

export async function savePaymentsAction(_prev: State, formData: FormData): Promise<State> {
  const f = formObject(formData);
  const methods = Object.fromEntries(
    DEPOSIT_METHODS.map((m) => [m, { enabled: formData.get(`${m}_enabled`) === "on", instructions: { en: f[`${m}_en`] ?? "", ar: f[`${m}_ar`] ?? "" } }]),
  ) as Record<(typeof DEPOSIT_METHODS)[number], { enabled: boolean; instructions: { en: string; ar: string } }>;
  // An enabled method must tell customers where to send the money.
  if (DEPOSIT_METHODS.some((m) => methods[m].enabled && (!methods[m].instructions.en.trim() || !methods[m].instructions.ar.trim()))) {
    return { error: "instructions_required" };
  }
  // The stored manualFallback approval (from the retired fallback switch) is
  // kept as history; it no longer gates anything.
  return done(
    await withAdmin("payments.manage", async ({ db, actor }) => {
      const current = await getSetting(db, "payments");
      return saveSetting(db, "payments", { manualFallback: current.manualFallback, methods }, actor);
    }),
  );
}

// Notifications ---------------------------------------------------------------

export async function sendTestNotificationAction(): Promise<State> {
  const res = await withAdmin("notifications.manage", async ({ db, actor, admin }) => {
    if (!(await consumeRateLimit(db, "notificationTest", admin.id))) return { ok: false as const, error: "rate_limited" };
    const id = await createTestNotification(db, actor);
    // Sent inline (not after the response) so the admin sees the real outcome.
    const outcome = await dispatchNotification(db, id, await getNotifierConfig(), { manual: true });
    return outcome === "sent" ? { ok: true as const } : { ok: false as const, error: `test_${outcome}` };
  });
  return done(res);
}

export async function retryNotificationAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "invalid_input" };
  const res = await withAdmin("notifications.manage", async ({ db, actor }) => {
    const outcome = await retryNotification(db, id.data, await getNotifierConfig(), actor);
    return outcome === "sent" ? { ok: true as const } : { ok: false as const, error: `test_${outcome}` };
  });
  return done(res);
}

// Email (contact form) ---------------------------------------------------------

/** Sends a fixed test email to CONTACT_FORM_EMAIL and reports Resend's real answer. */
export async function sendTestEmailAction(): Promise<State> {
  const res = await withAdmin("settings.edit", async ({ db, actor, admin }) => {
    if (!(await consumeRateLimit(db, "testEmail", admin.id))) return { ok: false as const, error: "rate_limited" };
    const status = await contactEmailStatus();
    if (!status.config) return { ok: false as const, error: "email_not_configured" };
    const sent = await sendEmail(status.config, { subject: "RoboNest.3D test email", text: "This is a test from the RoboNest.3D admin (Settings). If you received it, contact-form email delivery works." });
    await writeAudit(db, actor, { action: "settings.email.test", targetType: "setting", targetId: "email", metadata: { ok: sent.ok, status: sent.ok ? 200 : sent.status ?? null } });
    if (!sent.ok) {
      console.error("test email failed", { error: sent.error, status: sent.status, detail: sent.detail });
      return { ok: false as const, error: "email_rejected" };
    }
    return { ok: true as const };
  });
  return done(res);
}
