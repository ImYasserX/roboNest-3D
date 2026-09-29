import { eq } from "drizzle-orm";
import { AdminAuthError, requireAdminAction } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { products } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { getRequestMeta } from "@/server/request-meta";
import { addDigitalFile, addProductImage, setPreviewModel } from "@/server/services/product-admin";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { storeUploadFromRequest } from "@/server/storage/upload";
import { typeHasDigital } from "@/lib/domain";

// Admin media uploads. Raw file body; metadata in the query string.
//  PRODUCT_IMAGE / PREVIEW_MODEL → public MEDIA bucket (served via /media)
//  DIGITAL_FILE                  → PRIVATE_FILES bucket (download route only)
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
  const bucket = purpose === "DIGITAL_FILE" ? env.PRIVATE_FILES : env.MEDIA;
  const prefix = purpose === "PRODUCT_IMAGE" ? "products" : purpose === "PREVIEW_MODEL" ? "previews" : "digital";
  const stored = await storeUploadFromRequest(request, bucket, purpose, filename, prefix);
  if (!stored.ok) return Response.json({ error: stored.error }, { status: stored.error === "too_large" ? 413 : 415 });

  const actor = { adminId: admin.id, label: admin.username, ipHash };
  if (purpose === "PRODUCT_IMAGE") {
    await addProductImage(db, productId, { key: stored.file.key, width: stored.file.width, height: stored.file.height, filename: stored.file.filename }, actor);
  } else if (purpose === "PREVIEW_MODEL") {
    const res = await setPreviewModel(db, productId, stored.file.key, actor);
    if (res.ok && res.previousKey) await env.MEDIA.delete(res.previousKey);
  } else {
    await addDigitalFile(db, productId, stored.file, actor);
  }
  return Response.json({ ok: true }, { status: 201 });
}
