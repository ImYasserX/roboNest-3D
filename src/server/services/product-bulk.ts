import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { chunk, runBatch, type BatchStatement, type Database } from "@/server/db/client";
import { categories, digitalFiles, orderItems, orders, previewModels, products } from "@/server/db/schema";
import { AVAILABILITY, MAX_PRICE_IQD, PRODUCT_STATUSES } from "@/lib/domain";
import { auditInsert, type AuditActor } from "./audit";
import { buildSearchText, categoryNamesFor, deleteProduct, productListCondition, productListQuerySchema } from "./product-admin";

// Bulk product management for the admin Products page.
//
// Selection: either explicit ids (rows ticked on the current page) or "every
// product matching these filters", which the SERVER resolves again from the
// filter parameters (never from a client list), capped at MAX_BULK.
//
// Editing: only fields the admin explicitly ticked are changed. Every target
// product is validated with the same rules as the product editor first; if
// any product would become invalid, NOTHING is changed and the problems are
// reported per product. Valid edits are applied in one D1 batch (atomic).
//
// Deleting: a product that was ever ordered is never deleted (order history
// and buyers' download entitlements depend on it); it is archived instead,
// which also takes it and its 3D preview off the storefront. Products without
// orders are deleted with their images, preview proxies and paid files.

/** One D1 batch per bulk edit (atomic); kept small enough for D1 per-request query limits. */
export const MAX_BULK = 200;

const uuidList = z.array(z.string().uuid()).min(1).max(MAX_BULK);
const word = z.string().trim().min(1).max(40).refine((s) => !/[\u0000-\u001F\u007F,]/.test(s), "invalid_characters");

export const bulkSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("ids"), ids: uuidList }),
  z.object({ mode: z.literal("filter"), filter: z.record(z.string(), z.string()) }),
]);
export type BulkSelection = z.infer<typeof bulkSelectionSchema>;

export const bulkEditSchema = z
  .object({
    status: z.enum(PRODUCT_STATUSES).optional(),
    categoryId: z.string().uuid().optional(),
    availability: z.enum(AVAILABILITY).optional(),
    stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
    isFeatured: z.boolean().optional(),
    addTags: z.array(word).max(10).optional(),
    removeTags: z.array(word).max(10).optional(),
    addMaterials: z.array(word).max(10).optional(),
    removeMaterials: z.array(word).max(10).optional(),
    /** Whole-percent change of the base (and sale) price, e.g. 10 or -15. */
    pricePercent: z.number().int().min(-90).max(500).refine((n) => n !== 0).optional(),
    clearSalePrice: z.literal(true).optional(),
  })
  .refine((c) => Object.values(c).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0)), "no_changes");
export type BulkEdit = z.infer<typeof bulkEditSchema>;

export type BulkProblem = { id: string; name: string; error: string };

/** Resolves a selection to product ids on the server. */
export async function resolveSelection(db: Database, raw: unknown): Promise<{ ok: true; ids: string[] } | { ok: false; error: "invalid_selection" | "too_many" }> {
  const parsed = bulkSelectionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_selection" };
  if (parsed.data.mode === "ids") {
    const ids = [...new Set(parsed.data.ids)];
    const found: string[] = [];
    for (const part of chunk(ids)) found.push(...(await db.select({ id: products.id }).from(products).where(inArray(products.id, part))).map((r) => r.id));
    return found.length ? { ok: true, ids: found } : { ok: false, error: "invalid_selection" };
  }
  const query = productListQuerySchema.parse(parsed.data.filter);
  const condition = productListCondition(query);
  const total = await db.$count(products, condition);
  if (total === 0) return { ok: false, error: "invalid_selection" };
  if (total > MAX_BULK) return { ok: false, error: "too_many" };
  const rows = await db.select({ id: products.id }).from(products).where(condition).limit(MAX_BULK);
  return { ok: true, ids: rows.map((r) => r.id) };
}

async function loadRows(db: Database, ids: string[]) {
  const rows: (typeof products.$inferSelect)[] = [];
  for (const part of chunk(ids)) rows.push(...(await db.select().from(products).where(inArray(products.id, part))));
  return rows;
}

const merge = (list: string[], add: string[] = [], remove: string[] = []) => {
  const drop = new Set(remove.map((s) => s.toLowerCase()));
  const out = list.filter((s) => !drop.has(s.toLowerCase()));
  for (const a of add) if (!out.some((s) => s.toLowerCase() === a.toLowerCase())) out.push(a);
  return out;
};
const scale = (n: number, percent: number) => Math.round((n * (100 + percent)) / 100);

/** Computes the new values for one product, or the rule it would break. */
function applyEdit(row: typeof products.$inferSelect, edit: BulkEdit): { ok: true; patch: Partial<typeof products.$inferInsert>; changed: string[] } | { ok: false; error: string } {
  const patch: Partial<typeof products.$inferInsert> = {};
  const changed: string[] = [];
  const next = { ...row };
  const set = <K extends keyof typeof products.$inferInsert>(key: K, value: (typeof products.$inferInsert)[K]) => {
    if (JSON.stringify(row[key as keyof typeof row]) === JSON.stringify(value)) return;
    patch[key] = value;
    (next as Record<string, unknown>)[key] = value;
    changed.push(key);
  };
  if (edit.status) {
    set("status", edit.status);
    if (edit.status === "PUBLISHED" && !row.publishedAt) patch.publishedAt = new Date();
  }
  if (edit.categoryId) set("categoryId", edit.categoryId);
  if (edit.availability) set("availability", edit.availability);
  if (edit.stockQuantity !== undefined) set("stockQuantity", edit.stockQuantity);
  if (edit.isFeatured !== undefined) set("isFeatured", edit.isFeatured);
  if (edit.addTags?.length || edit.removeTags?.length) set("tags", merge(row.tags, edit.addTags, edit.removeTags).slice(0, 30));
  if (edit.addMaterials?.length || edit.removeMaterials?.length) set("materials", merge(row.materials, edit.addMaterials, edit.removeMaterials).slice(0, 15));
  if (edit.pricePercent !== undefined) {
    set("basePrice", scale(row.basePrice, edit.pricePercent));
    if (row.salePrice !== null && !edit.clearSalePrice) set("salePrice", scale(row.salePrice, edit.pricePercent));
  }
  if (edit.clearSalePrice) set("salePrice", null);

  // The product editor's rules (productInputSchema), applied to the result.
  if (next.basePrice > MAX_PRICE_IQD) return { ok: false, error: "price_too_high" };
  if (next.salePrice !== null && next.salePrice >= next.basePrice) return { ok: false, error: "sale_not_lower" };
  if (next.productType === "DIGITAL" && next.availability !== "DIGITAL") return { ok: false, error: "digital_availability" };
  if (next.productType !== "DIGITAL" && next.availability === "DIGITAL") return { ok: false, error: "physical_availability" };
  if (next.availability === "IN_STOCK" && next.stockQuantity === null) return { ok: false, error: "stock_required" };
  if (next.availability !== "IN_STOCK" && next.stockQuantity !== null) set("stockQuantity", null);
  return { ok: true, patch, changed };
}

export async function bulkUpdateProducts(db: Database, selection: unknown, rawEdit: unknown, actor: AuditActor) {
  const edit = bulkEditSchema.safeParse(rawEdit);
  if (!edit.success) return { ok: false as const, error: "invalid_input" as const };
  const sel = await resolveSelection(db, selection);
  if (!sel.ok) return { ok: false as const, error: sel.error };
  if (edit.data.categoryId && !(await db.select({ id: categories.id }).from(categories).where(eq(categories.id, edit.data.categoryId)).limit(1)).length) {
    return { ok: false as const, error: "invalid_input" as const };
  }
  const rows = await loadRows(db, sel.ids);
  const problems: BulkProblem[] = [];
  const updates: { row: (typeof rows)[number]; patch: Partial<typeof products.$inferInsert>; changed: string[] }[] = [];
  for (const row of rows) {
    const res = applyEdit(row, edit.data);
    if (!res.ok) problems.push({ id: row.id, name: row.nameEn, error: res.error });
    else if (res.changed.length) updates.push({ row, ...res });
  }
  if (problems.length) return { ok: false as const, error: "validation_failed" as const, problems, selected: rows.length };

  const namesCache = new Map<string, string[]>();
  const statements: BatchStatement[] = [];
  for (const u of updates) {
    const next = { ...u.row, ...u.patch } as typeof u.row;
    if (u.changed.some((c) => ["tags", "materials", "categoryId"].includes(c))) {
      if (!namesCache.has(next.categoryId)) namesCache.set(next.categoryId, (await categoryNamesFor(db, next.categoryId)) ?? []);
      u.patch.searchText = buildSearchText(next, namesCache.get(next.categoryId)!);
    }
    statements.push(db.update(products).set(u.patch).where(eq(products.id, u.row.id)));
  }
  if (updates.length) {
    statements.push(
      auditInsert(db, actor, {
        action: "product.bulk_updated",
        targetType: "product",
        metadata: {
          edit: edit.data,
          products: updates.map((u) => ({ id: u.row.id, slug: u.row.slug, fields: u.changed, from: Object.fromEntries(u.changed.map((k) => [k, u.row[k as keyof typeof u.row]])) })),
        },
      }),
    );
    // One transaction: every listed product changes, or none does.
    await runBatch(db, statements);
  }
  return { ok: true as const, selected: rows.length, updated: updates.length, unchanged: rows.length - updates.length };
}

/** What deleting would do, per product, shown in the confirmation dialog. */
export async function previewBulkDelete(db: Database, selection: unknown) {
  const sel = await resolveSelection(db, selection);
  if (!sel.ok) return { ok: false as const, error: sel.error };
  const rows = await loadRows(db, sel.ids);
  const out: { id: string; name: string; status: string; orders: number; paidOrders: number; files: number; previews: number; action: "delete" | "archive" | "keep_archived" }[] = [];
  for (const part of chunk(sel.ids)) {
    const [ordered, paid, files, previews] = await Promise.all([
      db.select({ id: orderItems.productId, n: sql<number>`COUNT(*)` }).from(orderItems).where(inArray(orderItems.productId, part)).groupBy(orderItems.productId),
      db
        .select({ id: orderItems.productId, n: sql<number>`COUNT(*)` })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(and(inArray(orderItems.productId, part), eq(orders.paymentStatus, "PAID")))
        .groupBy(orderItems.productId),
      db.select({ id: digitalFiles.productId, n: sql<number>`COUNT(*)` }).from(digitalFiles).where(inArray(digitalFiles.productId, part)).groupBy(digitalFiles.productId),
      db.select({ id: previewModels.productId, n: sql<number>`COUNT(*)` }).from(previewModels).where(inArray(previewModels.productId, part)).groupBy(previewModels.productId),
    ]);
    const count = (list: { id: string | null; n: number }[], id: string) => Number(list.find((r) => r.id === id)?.n ?? 0);
    for (const row of rows.filter((r) => part.includes(r.id))) {
      const n = count(ordered, row.id);
      out.push({
        id: row.id,
        name: row.nameEn,
        status: row.status,
        orders: n,
        paidOrders: count(paid, row.id),
        files: count(files, row.id),
        previews: count(previews, row.id),
        action: n === 0 ? "delete" : row.status === "ARCHIVED" ? "keep_archived" : "archive",
      });
    }
  }
  return { ok: true as const, items: out };
}

/**
 * Deletes products that were never ordered; archives the others. Not atomic
 * across products (each deletion is its own transaction plus storage cleanup),
 * so the result lists exactly what happened to each one.
 */
export async function bulkDeleteProducts(db: Database, selection: unknown, actor: AuditActor) {
  const plan = await previewBulkDelete(db, selection);
  if (!plan.ok) return plan;
  const results: { id: string; name: string; outcome: "deleted" | "archived" | "already_archived" | "failed"; error?: string }[] = [];
  const mediaKeys: string[] = [];
  const privateKeys: string[] = [];
  for (const item of plan.items) {
    if (item.action === "keep_archived") {
      results.push({ id: item.id, name: item.name, outcome: "already_archived" });
      continue;
    }
    if (item.action === "archive") {
      await runBatch(db, [
        db.update(products).set({ status: "ARCHIVED" }).where(eq(products.id, item.id)),
        auditInsert(db, actor, { action: "product.archived", targetType: "product", targetId: item.id, metadata: { reason: "bulk_delete_has_orders", orders: item.orders } }),
      ]);
      results.push({ id: item.id, name: item.name, outcome: "archived" });
      continue;
    }
    const res = await deleteProduct(db, item.id, actor);
    if (res.ok) {
      mediaKeys.push(...res.mediaKeys);
      privateKeys.push(...res.privateKeys);
      results.push({ id: item.id, name: item.name, outcome: "deleted" });
    } else {
      // Ordered in the meantime: archive instead of deleting.
      if (res.error === "has_orders") {
        await db.update(products).set({ status: "ARCHIVED" }).where(eq(products.id, item.id));
        results.push({ id: item.id, name: item.name, outcome: "archived" });
      } else results.push({ id: item.id, name: item.name, outcome: "failed", error: res.error });
    }
  }
  await auditInsert(db, actor, {
    action: "product.bulk_deleted",
    targetType: "product",
    metadata: { deleted: results.filter((r) => r.outcome === "deleted").length, archived: results.filter((r) => r.outcome === "archived").length },
  });
  return { ok: true as const, results, mediaKeys, privateKeys };
}
