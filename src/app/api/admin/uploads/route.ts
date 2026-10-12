import { eq } from "drizzle-orm";
import { AdminAuthError, requireAdminAction } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { products } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { getRequestMeta } from "@/server/request-meta";
import { addDigitalFile, addProductImage } from "@/server/services/product-admin";
import { fingerprintDigitalFile, uploadPreviewCandidate } from "@/server/services/previews";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { UPLOAD_RULES } from "@/server/storage/file-rules";
import { storeUploadFromRequest } from "@/server/storage/upload";
import { typeHasDigital } from "@/lib/domain";

// Admin media uploads. Raw file body; metadata in the query string.
//  PRODUCT_IMAGE → MEDIA bucket (raster images only, served via /media)
//  PREVIEW_MODEL → MEDIA under preview-proxies/ as a PENDING_REVIEW proxy,
//                  only if the bytes pass the proxy validator and differ from
//                  every paid file; served only after approval (/api/previews)
//  DIGITAL_FILE  → PRIVATE_FILES bucket (download route only)
// Turntable frame uploads were retired with the interactive viewer.
const PERMISSION = { PRODUCT_IMAGE: "products.edit", PREVIEW_MODEL: "products.edit", DIGITAL_FILE: "digitalFiles.manage" } as const;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const purpose = url.searchParams.get("purpose") as keyof typeof PERMISSION;
  const productId = url.searchParams.get("productId") ?? "";
  const filename = url.searchParams.get("filename") ?? "";
  if (!(purpose in PERMISSION) || !/^[0-9a-f-]{36}$/.test(productId) || !filename || filename.length > 200) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  let admin;
  try {
    admin = await requireAdminAction(PERMISSION[purpose]);
  } catch (error) {
    if (error instanceof AdminAuthError) return Response.json({ error: error.code }, { status: error.code === "unauthorized" ? 401 : 403 });
    throw error;
  }
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "upload", `admin:${admin.id}`))) return Response.json({ error: "rate_limited" }, { status: 429 });

  const [product] = await db.select({ id: products.id, productType: products.productType }).from(products).where(eq(products.id, productId)).limit(1);
  if (!product) return Response.json({ error: "not_found" }, { status: 404 });
  if (purpose === "DIGITAL_FILE" && !typeHasDigital(product.productType)) return Response.json({ error: "not_digital" }, { status: 400 });

  const env = await getEnv();
  const actor = { adminId: admin.id, label: admin.username, ipHash };

  if (purpose === "PREVIEW_MODEL") {
    // Small file: read it whole and validate the actual bytes before storing.
    const length = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(length) || length <= 0) return Response.json({ error: "missing_length" }, { status: 415 });
    if (length > UPLOAD_RULES.PREVIEW_MODEL.maxBytes) return Response.json({ error: "too_large" }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== length) return Response.json({ error: "upload_failed" }, { status: 400 });
    const res = await uploadPreviewCandidate(db, env, productId, bytes, actor);
    if (!res.ok) return Response.json({ error: res.error, reasons: res.reasons }, { status: 422 });
    return Response.json({ ok: true }, { status: 201 });
  }

  const bucket = purpose === "DIGITAL_FILE" ? env.PRIVATE_FILES : env.MEDIA;
  const prefix = purpose === "PRODUCT_IMAGE" ? "products" : "digital";
  const stored = await storeUploadFromRequest(request, bucket, purpose, filename, prefix);
  if (!stored.ok) return Response.json({ error: stored.error }, { status: stored.error === "too_large" ? 413 : 415 });

  if (purpose === "PRODUCT_IMAGE") {
    await addProductImage(db, productId, { key: stored.file.key, width: stored.file.width, height: stored.file.height, filename: stored.file.filename }, actor);
  } else {
    const fileId = await addDigitalFile(db, productId, stored.file, actor);
    // Fingerprint now (bounded size) so a copy of it can never pass as a preview.
    await fingerprintDigitalFile(db, env.PRIVATE_FILES, fileId).catch(() => null);
  }
  return Response.json({ ok: true }, { status: 201 });
}
