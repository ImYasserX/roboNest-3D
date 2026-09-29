import { and, eq, isNull } from "drizzle-orm";
import { getOwnerKey } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { uploads } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { getRequestMeta } from "@/server/request-meta";
import { consumeScoped } from "@/server/services/rate-limit";
import { storeUploadFromRequest } from "@/server/storage/upload";

// Customer uploads (custom print models, FILE product options). The request
// body is the raw file; metadata travels in the query string. Files land in
// the PRIVATE bucket under a random key and are owned by the uploader
// (signed-in user or anonymous visitor cookie) until attached to an order or
// custom request. Same-origin is enforced by src/proxy.ts.

const PURPOSES = ["CUSTOM_PRINT", "PRODUCT_OPTION"] as const;
const MAX_PENDING_PER_OWNER = 30;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const purpose = url.searchParams.get("purpose") as (typeof PURPOSES)[number];
  const filename = url.searchParams.get("filename") ?? "";
  if (!PURPOSES.includes(purpose) || filename.length === 0 || filename.length > 200) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  const ownerKey = (await getOwnerKey(true))!;
  if (!(await consumeScoped(db, "upload", "uploadIp", ownerKey, ipHash))) return Response.json({ error: "rate_limited" }, { status: 429 });
  // Storage-abuse guard: cap unattached uploads per owner.
  const pending = await db.$count(uploads, and(eq(uploads.ownerKey, ownerKey), isNull(uploads.attachedId)));
  if (pending >= MAX_PENDING_PER_OWNER) return Response.json({ error: "too_many_files" }, { status: 429 });

  const env = await getEnv();
  const stored = await storeUploadFromRequest(request, env.PRIVATE_FILES, purpose, filename, "uploads");
  if (!stored.ok) {
    const status = stored.error === "too_large" ? 413 : stored.error === "failed" ? 500 : 415;
    return Response.json({ error: stored.error }, { status });
  }
  const [row] = await db
    .insert(uploads)
    .values({
      ownerKey,
      purpose,
      r2Key: stored.file.key,
      filename: stored.file.filename,
      extension: stored.file.extension,
      sizeBytes: stored.file.sizeBytes,
    })
    .returning({ id: uploads.id });
  return Response.json({ id: row.id, filename: stored.file.filename, sizeBytes: stored.file.sizeBytes }, { status: 201 });
}
