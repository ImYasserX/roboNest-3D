import { eq } from "drizzle-orm";
import { AdminAuthError, requireAdminAction } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { uploads } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { attachmentHeaders } from "@/server/storage/upload";
import { hasPermission } from "@/lib/permissions";

// Staff download of customer-uploaded files (custom prints, FILE options).
// Always served as an attachment with a sandbox CSP; never rendered inline.
export async function GET(_request: Request, { params }: RouteContext<"/api/admin/files/[uploadId]">) {
  const { uploadId } = await params;
  let admin;
  try {
    admin = await requireAdminAction();
  } catch (error) {
    if (error instanceof AdminAuthError) return new Response("Forbidden", { status: error.code === "unauthorized" ? 401 : 403 });
    throw error;
  }
  if (!/^[0-9a-f-]{36}$/.test(uploadId)) return new Response("Not found", { status: 404 });
  const [file] = await (await getDb()).select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);
  if (!file || !file.attachedType) return new Response("Not found", { status: 404 });
  const needed = file.attachedType === "ORDER" ? "orders.view" : "customRequests.manage";
  if (!hasPermission(admin.role, needed)) return new Response("Forbidden", { status: 403 });
  const object = await (await getEnv()).PRIVATE_FILES.get(file.r2Key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body as unknown as ReadableStream, { headers: attachmentHeaders(file.filename, object.size) });
}
