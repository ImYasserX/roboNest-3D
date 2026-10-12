import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { servePreviewObject } from "@/server/preview/serve";
import { findServablePreview } from "@/server/services/previews";

// Public interactive-preview geometry. Serves ONLY a reduced preview proxy
// that a person approved, for a published product, addressed by its random
// preview id (never by storage key or path). Paid files are not reachable
// here: they live in PRIVATE_FILES, which this route never reads.
export async function GET(request: Request, { params }: RouteContext<"/api/previews/[id]">) {
  const { id } = await params;
  const db = await getDb();
  const row = await findServablePreview(db, id);
  if (!row) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return servePreviewObject(request, (await getEnv()).MEDIA, row);
}
