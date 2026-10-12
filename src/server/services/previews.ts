import "server-only";
import type { R2Bucket } from "@cloudflare/workers-types";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { runBatch, type Database } from "@/server/db/client";
import { digitalFiles, previewModels, products } from "@/server/db/schema";
import {
  ModelParseError,
  PROXY_MAX_BYTES,
  PROXY_MAX_SOURCE_RATIO,
  buildProxy,
  inspectProxyGlb,
  parseModel,
  sha256Hex,
  writeProxyGlb,
  type ProxyInspection,
} from "@/server/preview/proxy";
import { storageKey } from "@/server/storage/file-rules";
import { auditInsert, type AuditActor } from "./audit";

// Interactive preview proxies (see server/preview/proxy.ts for what a proxy is).
//
// Lifecycle: generate (from a paid file, server side) or upload (a proxy made
// elsewhere) → PENDING_REVIEW → an admin with previews.approve looks at it in
// the admin viewer and APPROVES or REJECTS it. Only APPROVED rows of
// PUBLISHED products are served publicly (/api/previews/[id]). Approval
// re-reads the stored bytes and re-runs every check. Nothing here writes to
// PRIVATE_FILES, changes an original, or publishes anything automatically.

/** Key layout of stored proxies in MEDIA. /media never serves this prefix. */
export const PREVIEW_PROXY_KEY = /^preview-proxies\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.glb$/;
/** Originals larger than this are not parsed inside the Worker (memory). */
export const MAX_SOURCE_BYTES_FOR_GENERATION = 25 * 1024 * 1024;
/** Proxies must keep at most this share of the original's triangles. */
export const MAX_PROXY_TRIANGLE_RATIO = PROXY_MAX_SOURCE_RATIO;
const GENERATABLE = new Set(["STL", "OBJ", "GLB"]);

export type PreviewError =
  | "not_found"
  | "source_too_large"
  | "unsupported_format"
  | "unreadable_source"
  | "rejected_by_validator"
  | "matches_original"
  | "not_reduced"
  | "bad_state"
  | "stored_object_changed";

type Buckets = { MEDIA: R2Bucket; PRIVATE_FILES: R2Bucket };
type Fail = { ok: false; error: PreviewError; reasons?: string[] };

/**
 * Computes (once) and stores the fingerprint of a paid file. Files too large
 * to parse are hashed only when they fit the same bound; otherwise left NULL.
 */
export async function fingerprintDigitalFile(db: Database, bucket: R2Bucket, fileId: string) {
  const [file] = await db.select().from(digitalFiles).where(eq(digitalFiles.id, fileId)).limit(1);
  if (!file) return null;
  if (file.sha256) return { sha256: file.sha256, triangleCount: file.triangleCount, bytes: null as Uint8Array | null, format: file.format };
  if (file.sizeBytes > MAX_SOURCE_BYTES_FOR_GENERATION) return null;
  const object = await bucket.get(file.r2Key);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  let triangleCount: number | null = null;
  if (GENERATABLE.has(file.format)) {
    try {
      triangleCount = Math.floor(parseModel(bytes, file.format).indices.length / 3);
    } catch {
      triangleCount = null;
    }
  }
  await db.update(digitalFiles).set({ sha256, triangleCount }).where(eq(digitalFiles.id, file.id));
  return { sha256, triangleCount, bytes, format: file.format };
}

/** Fingerprints every paid file of a product that has none yet (bounded by size). */
async function fingerprintProduct(db: Database, bucket: R2Bucket, productId: string) {
  const rows = await db.select({ id: digitalFiles.id }).from(digitalFiles).where(eq(digitalFiles.productId, productId));
  for (const row of rows) await fingerprintDigitalFile(db, bucket, row.id);
}

async function matchesAnyOriginal(db: Database, sha256: string) {
  return (await db.$count(digitalFiles, eq(digitalFiles.sha256, sha256))) > 0;
}

/** Highest known triangle count among the product's paid files (null if unknown). */
async function largestOriginal(db: Database, productId: string) {
  const rows = await db
    .select({ t: digitalFiles.triangleCount })
    .from(digitalFiles)
    .where(and(eq(digitalFiles.productId, productId), isNotNull(digitalFiles.triangleCount)));
  return rows.length ? Math.max(...rows.map((r) => r.t ?? 0)) : null;
}

async function storeCandidate(
  db: Database,
  media: R2Bucket,
  productId: string,
  glb: Uint8Array,
  inspection: ProxyInspection,
  meta: { source: "GENERATED" | "UPLOADED"; sourceDigitalFileId: string | null; sourceTriangleCount: number | null },
  actor: AuditActor & { adminId: string },
): Promise<{ ok: true; id: string } | Fail> {
  const sha256 = await sha256Hex(glb);
  if (await matchesAnyOriginal(db, sha256)) return { ok: false, error: "matches_original" };
  if (meta.sourceTriangleCount && inspection.triangles > meta.sourceTriangleCount * MAX_PROXY_TRIANGLE_RATIO) {
    return { ok: false, error: "not_reduced" };
  }
  const id = crypto.randomUUID();
  const key = storageKey("preview-proxies", "glb");
  await media.put(key, glb, {
    httpMetadata: { contentType: "model/gltf-binary" },
    customMetadata: { kind: "preview-proxy", sha256 },
  });
  try {
    await runBatch(db, [
      db.insert(previewModels).values({
        id,
        productId,
        r2Key: key,
        source: meta.source,
        sourceDigitalFileId: meta.sourceDigitalFileId,
        sha256,
        sizeBytes: glb.byteLength,
        triangleCount: inspection.triangles,
        vertexCount: inspection.vertices,
        sourceTriangleCount: meta.sourceTriangleCount,
        createdBy: actor.adminId,
      }),
      auditInsert(db, actor, {
        action: meta.source === "GENERATED" ? "preview.generated" : "preview.uploaded",
        targetType: "product",
        targetId: productId,
        metadata: { previewId: id, triangles: inspection.triangles, sourceTriangles: meta.sourceTriangleCount },
      }),
    ]);
  } catch (error) {
    await media.delete(key).catch(() => {});
    if (String(error).includes("preview_is_original")) return { ok: false, error: "matches_original" };
    throw error;
  }
  return { ok: true, id };
}

/** Builds a reduced proxy from one of the product's paid files. Result is PENDING_REVIEW. */
export async function generatePreviewFromFile(
  db: Database,
  buckets: Buckets,
  productId: string,
  digitalFileId: string,
  actor: AuditActor & { adminId: string },
  opts: { targetTriangles?: number } = {},
): Promise<{ ok: true; id: string; triangles: number; sourceTriangles: number } | Fail> {
  const [file] = await db
    .select()
    .from(digitalFiles)
    .where(and(eq(digitalFiles.id, digitalFileId), eq(digitalFiles.productId, productId)))
    .limit(1);
  if (!file) return { ok: false, error: "not_found" };
  if (!GENERATABLE.has(file.format)) return { ok: false, error: "unsupported_format" };
  if (file.sizeBytes > MAX_SOURCE_BYTES_FOR_GENERATION) return { ok: false, error: "source_too_large" };
  const object = await buckets.PRIVATE_FILES.get(file.r2Key);
  if (!object) return { ok: false, error: "not_found" };
  const bytes = new Uint8Array(await object.arrayBuffer());

  let built;
  try {
    built = buildProxy(parseModel(bytes, file.format), opts);
  } catch (error) {
    if (error instanceof ModelParseError) return error.message === "too_simple_to_reduce" ? { ok: false, error: "not_reduced" } : { ok: false, error: "unreadable_source" };
    throw error;
  }
  if (!file.sha256) {
    await db
      .update(digitalFiles)
      .set({ sha256: await sha256Hex(bytes), triangleCount: built.stats.sourceTriangles })
      .where(eq(digitalFiles.id, file.id));
  }
  const glb = writeProxyGlb(built.mesh);
  const inspection = inspectProxyGlb(glb);
  if (!inspection.ok) return { ok: false, error: "rejected_by_validator", reasons: inspection.reasons };
  const stored = await storeCandidate(
    db,
    buckets.MEDIA,
    productId,
    glb,
    inspection,
    { source: "GENERATED", sourceDigitalFileId: file.id, sourceTriangleCount: built.stats.sourceTriangles },
    actor,
  );
  return stored.ok ? { ...stored, triangles: inspection.triangles, sourceTriangles: built.stats.sourceTriangles } : stored;
}

/**
 * Accepts a proxy GLB made outside the app. The bytes are validated as a
 * proxy (not by extension or MIME type) and compared with the product's paid
 * files before anything is stored. Result is PENDING_REVIEW.
 */
export async function uploadPreviewCandidate(
  db: Database,
  buckets: Buckets,
  productId: string,
  glb: Uint8Array,
  actor: AuditActor & { adminId: string },
): Promise<{ ok: true; id: string } | Fail> {
  if (glb.byteLength > PROXY_MAX_BYTES) return { ok: false, error: "rejected_by_validator", reasons: ["too_large"] };
  const inspection = inspectProxyGlb(glb);
  if (!inspection.ok) return { ok: false, error: "rejected_by_validator", reasons: inspection.reasons };
  await fingerprintProduct(db, buckets.PRIVATE_FILES, productId);
  const sourceTriangleCount = await largestOriginal(db, productId);
  return storeCandidate(db, buckets.MEDIA, productId, glb, inspection, { source: "UPLOADED", sourceDigitalFileId: null, sourceTriangleCount }, actor);
}

/** Approves a pending (or previously rejected) proxy after re-validating the stored bytes. */
export async function approvePreview(db: Database, buckets: Buckets, previewId: string, actor: AuditActor & { adminId: string }): Promise<{ ok: true } | Fail> {
  const [row] = await db.select().from(previewModels).where(eq(previewModels.id, previewId)).limit(1);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "APPROVED") return { ok: false, error: "bad_state" };
  if (!PREVIEW_PROXY_KEY.test(row.r2Key)) return { ok: false, error: "stored_object_changed" };
  const object = await buckets.MEDIA.get(row.r2Key);
  if (!object) return { ok: false, error: "not_found" };
  const bytes = new Uint8Array(await object.arrayBuffer());
  if ((await sha256Hex(bytes)) !== row.sha256) return { ok: false, error: "stored_object_changed" };
  const inspection = inspectProxyGlb(bytes);
  if (!inspection.ok) return { ok: false, error: "rejected_by_validator", reasons: inspection.reasons };
  await fingerprintProduct(db, buckets.PRIVATE_FILES, row.productId);
  if (await matchesAnyOriginal(db, row.sha256)) return { ok: false, error: "matches_original" };
  const sourceTriangles = row.sourceTriangleCount ?? (await largestOriginal(db, row.productId));
  if (sourceTriangles && inspection.triangles > sourceTriangles * MAX_PROXY_TRIANGLE_RATIO) return { ok: false, error: "not_reduced" };

  const now = new Date();
  await runBatch(db, [
    // The previous approved proxy (if any) is retired first: one approved per product.
    db
      .update(previewModels)
      .set({ status: "REJECTED", rejectReason: "replaced", reviewedBy: actor.adminId, reviewedAt: now })
      .where(and(eq(previewModels.productId, row.productId), eq(previewModels.status, "APPROVED"), ne(previewModels.id, row.id))),
    db
      .update(previewModels)
      .set({ status: "APPROVED", rejectReason: null, reviewedBy: actor.adminId, reviewedAt: now })
      .where(and(eq(previewModels.id, row.id), ne(previewModels.status, "APPROVED"))),
    auditInsert(db, actor, { action: "preview.approved", targetType: "product", targetId: row.productId, metadata: { previewId: row.id, triangles: inspection.triangles } }),
  ]);
  return { ok: true };
}

/** Rejects a candidate, or withdraws the approved proxy (it stops being served immediately). */
export async function rejectPreview(db: Database, previewId: string, reason: string, actor: AuditActor & { adminId: string }): Promise<{ ok: true } | Fail> {
  const [row] = await db.select().from(previewModels).where(eq(previewModels.id, previewId)).limit(1);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "REJECTED") return { ok: false, error: "bad_state" };
  const clean = reason.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) || (row.status === "APPROVED" ? "withdrawn" : "rejected");
  await runBatch(db, [
    db.update(previewModels).set({ status: "REJECTED", rejectReason: clean, reviewedBy: actor.adminId, reviewedAt: new Date() }).where(eq(previewModels.id, row.id)),
    auditInsert(db, actor, {
      action: row.status === "APPROVED" ? "preview.withdrawn" : "preview.rejected",
      targetType: "product",
      targetId: row.productId,
      metadata: { previewId: row.id, reason: clean },
    }),
  ]);
  return { ok: true };
}

/** Deletes a NON-approved proxy and its stored object (a proxy, never an original). */
export async function deletePreview(db: Database, media: R2Bucket, previewId: string, actor: AuditActor) {
  const [row] = await db.select().from(previewModels).where(eq(previewModels.id, previewId)).limit(1);
  if (!row || row.status === "APPROVED") return { ok: false as const };
  await runBatch(db, [
    db.delete(previewModels).where(eq(previewModels.id, row.id)),
    auditInsert(db, actor, { action: "preview.deleted", targetType: "product", targetId: row.productId, metadata: { previewId: row.id } }),
  ]);
  if (PREVIEW_PROXY_KEY.test(row.r2Key)) await media.delete(row.r2Key);
  return { ok: true as const };
}

export async function listPreviewsForProduct(db: Database, productId: string) {
  return db
    .select({
      id: previewModels.id,
      status: previewModels.status,
      source: previewModels.source,
      sourceDigitalFileId: previewModels.sourceDigitalFileId,
      triangleCount: previewModels.triangleCount,
      sourceTriangleCount: previewModels.sourceTriangleCount,
      sizeBytes: previewModels.sizeBytes,
      rejectReason: previewModels.rejectReason,
      reviewedAt: previewModels.reviewedAt,
      createdAt: previewModels.createdAt,
    })
    .from(previewModels)
    .where(eq(previewModels.productId, productId))
    .orderBy(desc(previewModels.createdAt))
    .limit(20);
}

/**
 * The approved, servable proxy for a public request. Requires the preview to
 * be APPROVED, its product PUBLISHED, and its key in the proxy layout.
 */
export async function findServablePreview(db: Database, previewId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(previewId)) return null;
  const [row] = await db
    .select({ id: previewModels.id, r2Key: previewModels.r2Key, sha256: previewModels.sha256, sizeBytes: previewModels.sizeBytes })
    .from(previewModels)
    .innerJoin(products, eq(products.id, previewModels.productId))
    .where(and(eq(previewModels.id, previewId), eq(previewModels.status, "APPROVED"), eq(products.status, "PUBLISHED")))
    .limit(1);
  return row && PREVIEW_PROXY_KEY.test(row.r2Key) ? row : null;
}

/** Any proxy (any status) for the admin review viewer. */
export async function findPreviewForReview(db: Database, previewId: string) {
  if (!/^[0-9a-f-]{36}$/.test(previewId)) return null;
  const [row] = await db.select({ id: previewModels.id, r2Key: previewModels.r2Key, sha256: previewModels.sha256 }).from(previewModels).where(eq(previewModels.id, previewId)).limit(1);
  return row && PREVIEW_PROXY_KEY.test(row.r2Key) ? row : null;
}

export type LegacyAudit =
  | { state: "none" }
  | { state: "missing" }
  | { state: "inspected"; sizeBytes: number; matchesOriginal: boolean; inspection: ProxyInspection };

/**
 * Reports on the legacy products.preview_model_key GLB WITHOUT serving,
 * publishing, moving or deleting it. A legacy file that would pass as a proxy
 * still has to be re-imported through upload and approved by a person.
 */
export async function auditLegacyPreview(db: Database, buckets: Buckets, productId: string, actor: AuditActor): Promise<LegacyAudit> {
  const [product] = await db.select({ key: products.previewModelKey }).from(products).where(eq(products.id, productId)).limit(1);
  if (!product?.key) return { state: "none" };
  const head = await buckets.MEDIA.head(product.key);
  if (!head) return { state: "missing" };
  let result: LegacyAudit;
  if (head.size > MAX_SOURCE_BYTES_FOR_GENERATION) {
    result = { state: "inspected", sizeBytes: head.size, matchesOriginal: false, inspection: { ok: false, reasons: ["too_large"], triangles: 0, vertices: 0, maxDistinctPerAxis: 0, extent: 0, byteLength: head.size } };
  } else {
    const bytes = new Uint8Array(await (await buckets.MEDIA.get(product.key))!.arrayBuffer());
    await fingerprintProduct(db, buckets.PRIVATE_FILES, productId);
    const matchesOriginal = await matchesAnyOriginal(db, await sha256Hex(bytes));
    const inspection = inspectProxyGlb(bytes);
    result = { state: "inspected", sizeBytes: bytes.byteLength, matchesOriginal, inspection: matchesOriginal ? { ...inspection, ok: false, reasons: [...inspection.reasons, "matches_original"] } : inspection };
  }
  if (result.state === "inspected") {
    await auditInsert(db, actor, {
      action: "preview.legacy_audited",
      targetType: "product",
      targetId: productId,
      metadata: { qualifies: result.inspection.ok, reasons: result.inspection.reasons, triangles: result.inspection.triangles },
    });
  }
  return result;
}
