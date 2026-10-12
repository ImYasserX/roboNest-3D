import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { qualified } from "@/server/db/sql";
import { chunk, runBatch, type Database } from "@/server/db/client";
import { digitalFiles, orderItems, orders, previewModels, products } from "@/server/db/schema";
import { DIGITAL_FORMATS, PREVIEW_STATUSES } from "@/lib/domain";
import { escapeLike, normalizeSearchText } from "@/lib/search-normalize";
import { auditInsert, type AuditActor } from "./audit";

// Admin management of ORIGINAL PAID FILES (digital_files, PRIVATE_FILES bucket).
// They are never public: nothing here changes how they are served (only the
// authorized download route streams them). Changing "active" only decides
// whether entitled buyers can download them; it never makes a file public.
//
// "Entitled buyers" = order items for the file's product in orders that are
// not cancelled / returned. Their access is what deactivation and deletion
// could take away, so both are guarded:
//  - deactivating files with entitled buyers needs an explicit acknowledgement;
//  - deleting is refused while ANY order references the product (the file is
//    part of what was sold); deactivate or replace it instead.
//
// Preview proxies (preview_models) and product photos are separate assets and
// are managed elsewhere; this module never touches them.

export const DIGITAL_FILES_PAGE_SIZE = 25;

export const digitalFileQuerySchema = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  format: z.enum(DIGITAL_FORMATS).optional().catch(undefined),
  active: z.enum(["1", "0"]).optional().catch(undefined),
  sort: z.enum(["newest", "oldest", "name", "size", "downloads"]).optional().catch(undefined),
  page: z.preprocess((v) => Number(v ?? 1), z.number().int().min(1).max(10_000)).catch(1),
});

const entitledSql = sql<number>`(SELECT COUNT(*) FROM ${orderItems} JOIN ${orders} ON ${qualified(orders.id)} = ${qualified(orderItems.orderId)}
  WHERE ${qualified(orderItems.productId)} = ${qualified(digitalFiles.productId)} AND ${qualified(orderItems.isDigital)} = 1
  AND ${qualified(orders.status)} NOT IN ('CANCELLED', 'RETURNED', 'RETURN_REQUESTED'))`;
const paidSql = sql<number>`(SELECT COUNT(*) FROM ${orderItems} JOIN ${orders} ON ${qualified(orders.id)} = ${qualified(orderItems.orderId)}
  WHERE ${qualified(orderItems.productId)} = ${qualified(digitalFiles.productId)} AND ${qualified(orderItems.isDigital)} = 1
  AND ${qualified(orders.paymentStatus)} = 'PAID' AND ${qualified(orders.status)} NOT IN ('CANCELLED', 'RETURNED', 'RETURN_REQUESTED'))`;
const downloadsSql = sql<number>`(SELECT COALESCE(SUM(${qualified(orderItems.downloadCount)}), 0) FROM ${orderItems} WHERE ${qualified(orderItems.productId)} = ${qualified(digitalFiles.productId)})`;

export async function listDigitalFilesAdmin(db: Database, raw: Record<string, string | undefined>) {
  const query = digitalFileQuerySchema.parse(raw);
  const where: SQL[] = [];
  if (query.format) where.push(eq(digitalFiles.format, query.format));
  if (query.active) where.push(eq(digitalFiles.isActive, query.active === "1"));
  if (query.q) {
    const pattern = `%${escapeLike(query.q.toLowerCase())}%`;
    where.push(sql`(lower(${digitalFiles.filename}) LIKE ${pattern} ESCAPE '\\' OR ${products.searchText} LIKE ${`%${escapeLike(normalizeSearchText(query.q))}%`} ESCAPE '\\' OR ${products.slug} LIKE ${pattern} ESCAPE '\\')`);
  }
  const condition = where.length ? and(...where) : undefined;
  const orderBy =
    query.sort === "oldest" ? asc(digitalFiles.createdAt) : query.sort === "name" ? asc(digitalFiles.filename) : query.sort === "size" ? desc(digitalFiles.sizeBytes) : query.sort === "downloads" ? desc(downloadsSql) : desc(digitalFiles.createdAt);
  const [total] = await db.select({ n: sql<number>`COUNT(*)` }).from(digitalFiles).innerJoin(products, eq(products.id, digitalFiles.productId)).where(condition);
  const count = Number(total?.n ?? 0);
  const pageCount = Math.max(1, Math.ceil(count / DIGITAL_FILES_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const rows = await db
    .select({
      id: digitalFiles.id,
      filename: digitalFiles.filename,
      format: digitalFiles.format,
      sizeBytes: digitalFiles.sizeBytes,
      isActive: digitalFiles.isActive,
      createdAt: digitalFiles.createdAt,
      productId: products.id,
      productStatus: products.status,
      productNameEn: products.nameEn,
      productNameAr: products.nameAr,
      entitled: entitledSql,
      paidBuyers: paidSql,
      downloads: downloadsSql,
    })
    .from(digitalFiles)
    .innerJoin(products, eq(products.id, digitalFiles.productId))
    .where(condition)
    .orderBy(orderBy)
    .limit(DIGITAL_FILES_PAGE_SIZE)
    .offset((page - 1) * DIGITAL_FILES_PAGE_SIZE);
  return { query, rows: rows.map((r) => ({ ...r, entitled: Number(r.entitled), paidBuyers: Number(r.paidBuyers), downloads: Number(r.downloads) })), total: count, page, pageCount };
}

const idsSchema = z.array(z.string().uuid()).min(1).max(100);

async function filesWithBuyers(db: Database, ids: string[]) {
  const out: { id: string; productId: string; filename: string; isActive: boolean; r2Key: string; entitled: number; orders: number }[] = [];
  for (const part of chunk(ids)) {
    const rows = await db
      .select({
        id: digitalFiles.id,
        productId: digitalFiles.productId,
        filename: digitalFiles.filename,
        isActive: digitalFiles.isActive,
        r2Key: digitalFiles.r2Key,
        entitled: entitledSql,
        orders: sql<number>`(SELECT COUNT(*) FROM ${orderItems} WHERE ${qualified(orderItems.productId)} = ${qualified(digitalFiles.productId)})`,
      })
      .from(digitalFiles)
      .where(inArray(digitalFiles.id, part));
    out.push(...rows.map((r) => ({ ...r, entitled: Number(r.entitled), orders: Number(r.orders) })));
  }
  return out;
}

/** Activate or deactivate files. Deactivating files that buyers can download needs `acknowledgeBuyers`. */
export async function bulkSetDigitalFilesActive(db: Database, rawIds: unknown, active: boolean, acknowledgeBuyers: boolean, actor: AuditActor) {
  const ids = idsSchema.safeParse(rawIds);
  if (!ids.success) return { ok: false as const, error: "invalid_selection" as const };
  const files = await filesWithBuyers(db, ids.data);
  if (!files.length) return { ok: false as const, error: "invalid_selection" as const };
  const affected = files.filter((f) => f.isActive && f.entitled > 0);
  if (!active && affected.length && !acknowledgeBuyers) {
    return { ok: false as const, error: "buyers_affected" as const, buyers: affected.reduce((n, f) => n + f.entitled, 0) };
  }
  const changing = files.filter((f) => f.isActive !== active);
  if (changing.length) {
    await runBatch(db, [
      db.update(digitalFiles).set({ isActive: active }).where(inArray(digitalFiles.id, changing.map((f) => f.id))),
      auditInsert(db, actor, {
        action: active ? "digitalFile.bulk_activated" : "digitalFile.bulk_deactivated",
        targetType: "digitalFile",
        metadata: { files: changing.map((f) => ({ id: f.id, productId: f.productId, filename: f.filename, entitledBuyers: f.entitled })) },
      }),
    ]);
  }
  return { ok: true as const, changed: changing.length, unchanged: files.length - changing.length };
}

/**
 * Permanently deletes paid files that NO order references. Files of ordered
 * products are refused (listed in `kept`); deactivate them instead.
 * Returns the PRIVATE_FILES keys to delete after the rows are gone.
 */
export async function bulkDeleteDigitalFiles(db: Database, rawIds: unknown, actor: AuditActor) {
  const ids = idsSchema.safeParse(rawIds);
  if (!ids.success) return { ok: false as const, error: "invalid_selection" as const };
  const files = await filesWithBuyers(db, ids.data);
  const deletable = files.filter((f) => f.orders === 0);
  const kept = files.filter((f) => f.orders > 0).map((f) => ({ id: f.id, filename: f.filename, orders: f.orders }));
  if (deletable.length) {
    await runBatch(db, [
      // Re-checked inside the statement: never delete a file whose product got an order meanwhile.
      db.delete(digitalFiles).where(and(inArray(digitalFiles.id, deletable.map((f) => f.id)), sql`NOT EXISTS (SELECT 1 FROM ${orderItems} WHERE ${qualified(orderItems.productId)} = ${qualified(digitalFiles.productId)})`)),
      auditInsert(db, actor, { action: "digitalFile.bulk_deleted", targetType: "digitalFile", metadata: { files: deletable.map((f) => ({ id: f.id, productId: f.productId, filename: f.filename })), kept: kept.length } }),
    ]);
  }
  // Only delete objects whose rows are really gone.
  const remaining = deletable.length ? (await db.select({ id: digitalFiles.id }).from(digitalFiles).where(inArray(digitalFiles.id, deletable.map((f) => f.id)))).map((r) => r.id) : [];
  const deleted = deletable.filter((f) => !remaining.includes(f.id));
  return { ok: true as const, deleted: deleted.length, kept, keys: deleted.map((f) => f.r2Key) };
}

/** Changes the filename buyers see when downloading (metadata only; the stored object is untouched). */
export async function renameDigitalFile(db: Database, fileId: string, rawName: unknown, actor: AuditActor) {
  const name = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((s) => !/[\u0000-\u001F\u007F\\/]/.test(s) && /\.[a-z0-9]{1,5}$/i.test(s), "invalid_name")
    .safeParse(rawName);
  if (!name.success || !z.string().uuid().safeParse(fileId).success) return { ok: false as const, error: "invalid_input" as const };
  const [file] = await db.select({ id: digitalFiles.id, filename: digitalFiles.filename, format: digitalFiles.format }).from(digitalFiles).where(eq(digitalFiles.id, fileId)).limit(1);
  if (!file) return { ok: false as const, error: "not_found" as const };
  // The extension must keep matching the stored format.
  if (!name.data.toLowerCase().endsWith(`.${file.format.toLowerCase()}`)) return { ok: false as const, error: "extension_mismatch" as const };
  await runBatch(db, [
    db.update(digitalFiles).set({ filename: name.data }).where(eq(digitalFiles.id, fileId)),
    auditInsert(db, actor, { action: "digitalFile.renamed", targetType: "digitalFile", targetId: fileId, metadata: { from: file.filename, to: name.data } }),
  ]);
  return { ok: true as const };
}

/** All preview proxies across products, for the preview review tab. */
export async function listPreviewsAdmin(db: Database, rawStatus?: string) {
  const status = z.enum(PREVIEW_STATUSES).optional().catch(undefined).parse(rawStatus);
  return db
    .select({
      id: previewModels.id,
      status: previewModels.status,
      source: previewModels.source,
      triangleCount: previewModels.triangleCount,
      sourceTriangleCount: previewModels.sourceTriangleCount,
      sizeBytes: previewModels.sizeBytes,
      createdAt: previewModels.createdAt,
      productId: products.id,
      productStatus: products.status,
      productNameEn: products.nameEn,
      productNameAr: products.nameAr,
    })
    .from(previewModels)
    .innerJoin(products, eq(products.id, previewModels.productId))
    .where(status ? eq(previewModels.status, status) : undefined)
    .orderBy(desc(previewModels.createdAt))
    .limit(100);
}

