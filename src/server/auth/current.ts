import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { isProduction } from "@/server/env";
import { getSetting } from "@/server/services/settings";
import { hasPermission, roleRequiresTotp, type Permission } from "@/lib/permissions";
import { randomToken, sha256Hex } from "./crypto";
import {
  validateAdminSession,
  validateCustomerSession,
  type AdminSession,
  type CustomerSessionUser,
} from "./sessions";

// Cookie names use the __Host- prefix in production, which the browser only
// accepts with Secure, Path=/ and no Domain, preventing subdomain injection.
const prefix = isProduction ? "__Host-" : "";
export const CUSTOMER_COOKIE = `${prefix}rn_session`;
export const ADMIN_COOKIE = `${prefix}rn_admin`;
export const VISITOR_COOKIE = `${prefix}rn_visitor`;

const baseCookie = { httpOnly: true, secure: isProduction, path: "/" } as const;

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const getCurrentUser = cache(async (): Promise<CustomerSessionUser | null> => {
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  return validateCustomerSession(await getDb(), token);
});

export async function setCustomerSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(CUSTOMER_COOKIE, token, { ...baseCookie, sameSite: "lax", expires: expiresAt });
}

export async function readCustomerSessionToken() {
  return (await cookies()).get(CUSTOMER_COOKIE)?.value ?? null;
}

export async function clearCustomerSessionCookie() {
  (await cookies()).delete({ name: CUSTOMER_COOKIE, path: "/", secure: isProduction });
}

export async function requireCustomerPage(locale: string, nextPath: string): Promise<CustomerSessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

// ---------------------------------------------------------------------------
// Anonymous visitor identity (cart + uploads before login)
// ---------------------------------------------------------------------------

export async function getVisitorHash(): Promise<string | null> {
  const token = (await cookies()).get(VISITOR_COOKIE)?.value;
  if (!token || token.length > 128) return null;
  return sha256Hex(token);
}

/** Only callable where cookies can be written (server actions, route handlers). */
export async function getOrCreateVisitorHash(): Promise<string> {
  const store = await cookies();
  const existing = store.get(VISITOR_COOKIE)?.value;
  if (existing && existing.length <= 128) return sha256Hex(existing);
  const token = randomToken();
  store.set(VISITOR_COOKIE, token, {
    ...baseCookie,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 90,
  });
  return sha256Hex(token);
}

/** Owner key for uploads/carts: the signed-in user, else the visitor. */
export async function getOwnerKey(create: boolean): Promise<string | null> {
  const user = await getCurrentUser();
  if (user) return `user:${user.id}`;
  const visitor = create ? await getOrCreateVisitorHash() : await getVisitorHash();
  return visitor ? `visitor:${visitor}` : null;
}

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  return validateAdminSession(await getDb(), token);
});

export async function setAdminSessionCookie(token: string, expiresAt: Date) {
  // SameSite=Strict: the admin area is never entered from cross-site links.
  (await cookies()).set(ADMIN_COOKIE, token, { ...baseCookie, sameSite: "strict", expires: expiresAt });
}

export async function readAdminSessionToken() {
  return (await cookies()).get(ADMIN_COOKIE)?.value ?? null;
}

export async function clearAdminSessionCookie() {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: "/", secure: isProduction });
}

export type AdminContext = AdminSession["admin"] & { sessionId: string };

/** Super Admins always need TOTP; other roles when the security setting says so. */
async function needsTotpEnrollment(session: AdminSession) {
  if (session.admin.totpEnabled) return false;
  if (roleRequiresTotp(session.admin.role)) return true;
  return (await getSetting(await getDb(), "security")).requireTotpForAllAdmins;
}

/**
 * Guard for admin pages. Unauthenticated → login; MFA pending → verify step;
 * Super Admin without TOTP → forced enrollment; missing permission → 403.
 */
export async function requireAdminPage(
  locale: string,
  permission?: Permission,
  opts: { allowEnrollment?: boolean } = {},
): Promise<AdminContext> {
  const session = await getAdminSession();
  if (!session) redirect(`/${locale}/admin/login`);
  if (session.stage === "MFA_PENDING") redirect(`/${locale}/admin/login/verify`);
  if (!opts.allowEnrollment && (await needsTotpEnrollment(session))) redirect(`/${locale}/admin/security`);
  if (permission && !hasPermission(session.admin.role, permission)) redirect(`/${locale}/admin/forbidden`);
  return { ...session.admin, sessionId: session.sessionId };
}

export class AdminAuthError extends Error {
  constructor(public readonly code: "unauthorized" | "forbidden") {
    super(code);
  }
}

/** Guard for admin server actions and API routes. Throws AdminAuthError. */
export async function requireAdminAction(
  permission?: Permission,
  opts: { allowEnrollment?: boolean } = {},
): Promise<AdminContext> {
  const session = await getAdminSession();
  if (!session || session.stage !== "ACTIVE") throw new AdminAuthError("unauthorized");
  if (!opts.allowEnrollment && (await needsTotpEnrollment(session))) throw new AdminAuthError("forbidden");
  if (permission && !hasPermission(session.admin.role, permission)) throw new AdminAuthError("forbidden");
  return { ...session.admin, sessionId: session.sessionId };
}

// ---------------------------------------------------------------------------
// Phone verification challenge (raw token in an HttpOnly cookie; DB stores its hash)
// ---------------------------------------------------------------------------

export const VERIFY_COOKIE = `${prefix}rn_verify`;

export async function setVerifyCookie(token: string) {
  (await cookies()).set(VERIFY_COOKIE, token, { ...baseCookie, sameSite: "lax", maxAge: 15 * 60 });
}

export async function readVerifyCookie() {
  return (await cookies()).get(VERIFY_COOKIE)?.value ?? null;
}

export async function clearVerifyCookie() {
  (await cookies()).delete({ name: VERIFY_COOKIE, path: "/", secure: isProduction });
}
