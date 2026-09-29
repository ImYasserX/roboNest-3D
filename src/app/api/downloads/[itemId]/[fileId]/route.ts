import { getLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { authorizeDownload } from "@/server/services/downloads";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { attachmentHeaders } from "@/server/storage/upload";

// Streams a purchased digital file from the private bucket after checking
// session, ownership, payment and download limits. No signed or public URL is
// ever exposed; storage credentials never leave the Worker.
export async function GET(request: Request, { params }: RouteContext<"/api/downloads/[itemId]/[fileId]">) {
  const { itemId, fileId } = await params;
  const referer = request.headers.get("referer") ?? "";
  const locale = /\/en\//.test(referer) ? "en" : await getLocale().catch(() => "ar");
  const back = (error: string) => Response.redirect(new URL(`/${locale}/account/downloads?error=${error}`, request.url), 303);

  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL(`/${locale}/login?next=/account/downloads`, request.url), 303);
  const db = await getDb();
  if (!(await consumeRateLimit(db, "download", user.id))) return new Response("Too many requests", { status: 429 });

  const auth = await authorizeDownload(db, user.id, itemId, fileId);
  if (!auth.ok) return back(auth.error);
  const object = await (await getEnv()).PRIVATE_FILES.get(auth.file.r2Key);
  if (!object) return back("not_found");
  return new Response(object.body as unknown as ReadableStream, { headers: attachmentHeaders(auth.file.filename, object.size) });
}
