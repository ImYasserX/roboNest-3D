"use server";

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getLocale } from "next-intl/server";
import {
  clearAdminSessionCookie,
  getAdminSession,
  readAdminSessionToken,
  setAdminSessionCookie,
} from "@/server/auth/current";
import { createAdminSession, deleteAdminSessionById } from "@/server/auth/sessions";
import { sha256Hex } from "@/server/auth/crypto";
import { withAdmin } from "@/server/admin-action";
import { getDb } from "@/server/db/client";
import { getAppSecret } from "@/server/env";
import { getRequestMeta } from "@/server/request-meta";
import {
  authenticateAdmin,
  beginTotpEnrollment,
  changeAdminPassword,
  confirmTotpEnrollment,
  logAdminLogout,
  recordAdminLogin,
  verifyAdminSecondFactor,
} from "@/server/services/admin-auth";
import { consumeRateLimit } from "@/server/services/rate-limit";

type State = { error?: string; success?: boolean } | null;

async function replaceSession(adminId: string, stage: "MFA_PENDING" | "ACTIVE") {
  const db = await getDb();
  const previous = await readAdminSessionToken();
  if (previous) await deleteAdminSessionById(db, await sha256Hex(previous));
  const { token, expiresAt } = await createAdminSession(db, adminId, stage, await getRequestMeta());
  await setAdminSessionCookie(token, expiresAt);
}

export async function adminLoginAction(_prev: State, formData: FormData): Promise<State> {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "adminLogin", ipHash))) return { error: "rate_limited" };
  const username = String(formData.get("username") ?? "").slice(0, 64);
  const result = await authenticateAdmin(db, { username, password: String(formData.get("password") ?? "").slice(0, 200) }, ipHash);
  if (!result.ok) return { error: result.error };
  const locale = await getLocale();
  if (result.needsTotp) {
    await replaceSession(result.adminId, "MFA_PENDING");
    redirect(`/${locale}/admin/login/verify`);
  }
  await replaceSession(result.adminId, "ACTIVE");
  await recordAdminLogin(db, result.adminId, username.toLowerCase(), ipHash);
  redirect(`/${locale}/admin`);
}

export async function adminVerifyAction(_prev: State, formData: FormData): Promise<State> {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "adminTotp", ipHash))) return { error: "rate_limited" };
  const session = await getAdminSession();
  if (!session || session.stage !== "MFA_PENDING") return { error: "expired" };
  const result = await verifyAdminSecondFactor(db, session.sessionId, session.admin.id, String(formData.get("code") ?? "").slice(0, 12), await getAppSecret());
  if (!result.ok) return { error: result.error };
  // Promote by issuing a brand-new session token (no reuse of the pending one).
  await replaceSession(session.admin.id, "ACTIVE");
  await recordAdminLogin(db, session.admin.id, session.admin.username, ipHash);
  redirect(`/${await getLocale()}/admin`);
}

export async function adminLogoutAction(): Promise<void> {
  const db = await getDb();
  const session = await getAdminSession();
  if (session) {
    await logAdminLogout(db, { adminId: session.admin.id, label: session.admin.username, ipHash: (await getRequestMeta()).ipHash });
    await deleteAdminSessionById(db, session.sessionId);
  }
  await clearAdminSessionCookie();
  redirect(`/${await getLocale()}/admin/login`);
}

export async function beginTotpAction() {
  return withAdmin(
    null,
    async ({ admin, db }) => {
      if (admin.totpEnabled) return { ok: false as const, error: "already_enabled" };
      const { secret, uri } = await beginTotpEnrollment(db, admin.id, admin.username, await getAppSecret());
      const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 220, color: { dark: "#17131f", light: "#ffffff" } });
      return { ok: true as const, secret, qrSvg };
    },
    { allowEnrollment: true },
  );
}

export async function confirmTotpAction(_prev: State, formData: FormData): Promise<State> {
  const res = await withAdmin(
    null,
    async ({ admin, actor, db }) => confirmTotpEnrollment(db, admin.id, String(formData.get("code") ?? "").slice(0, 12), await getAppSecret(), actor),
    { allowEnrollment: true },
  );
  if (!res.ok) return { error: res.error };
  redirect(`/${await getLocale()}/admin/security?enabled=1`);
}

export async function changeAdminPasswordAction(_prev: State, formData: FormData): Promise<State> {
  const res = await withAdmin(
    null,
    async ({ admin, actor, db }) => {
      if (!(await consumeRateLimit(db, "passwordChange", `admin:${admin.id}`))) return { ok: false as const, error: "rate_limited" };
      return changeAdminPassword(db, admin.id, String(formData.get("current") ?? ""), String(formData.get("next") ?? ""), admin.sessionId, actor);
    },
    { allowEnrollment: true },
  );
  return res.ok ? { success: true } : { error: res.error };
}
