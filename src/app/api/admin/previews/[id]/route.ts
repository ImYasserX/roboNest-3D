import { AdminAuthError, requireAdminAction } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { servePreviewObject } from "@/server/preview/serve";
import { findPreviewForReview } from "@/server/services/previews";

// Admin review copy of a preview proxy in any state (pending, approved,
// rejected), so it can be inspected in the viewer before approval.
export async function GET(request: Request, { params }: RouteContext<"/api/admin/previews/[id]">) {
  try {
    await requireAdminAction("products.view");
  } catch (error) {
    if (error instanceof AdminAuthError) return new Response(null, { status: error.code === "unauthorized" ? 401 : 403 });
    throw error;
  }
  const { id } = await params;
  const row = await findPreviewForReview(await getDb(), id);
  if (!row) return new Response("Not found", { status: 404 });
  return servePreviewObject(request, (await getEnv()).MEDIA, row);
}
