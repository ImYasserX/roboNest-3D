import "server-only";
import { AdminAuthError, requireAdminAction, type AdminContext } from "@/server/auth/current";
import { getDb, type Database } from "@/server/db/client";
import { getRequestMeta } from "@/server/request-meta";
import type { AuditActor } from "@/server/services/audit";
import type { Permission } from "@/lib/permissions";

export type AdminActionError = { ok: false; error: "unauthorized" | "forbidden" };

type Ctx = { admin: AdminContext; actor: AuditActor & { adminId: string }; db: Database };

/**
 * Runs an admin mutation after server-side authentication and permission
 * checks. Hidden buttons in the UI are a convenience, never the control.
 */
export async function withAdmin<T>(permission: Permission | null, fn: (ctx: Ctx) => Promise<T>, opts: { allowEnrollment?: boolean } = {}): Promise<T | AdminActionError> {
  let admin: AdminContext;
  try {
    admin = await requireAdminAction(permission ?? undefined, opts);
  } catch (error) {
    if (error instanceof AdminAuthError) return { ok: false, error: error.code };
    throw error;
  }
  const { ipHash } = await getRequestMeta();
  return fn({ admin, actor: { adminId: admin.id, label: admin.username, ipHash }, db: await getDb() });
}

/** FormData → plain object (single values; repeated keys become arrays). */
export function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}
