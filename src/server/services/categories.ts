import { eq } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type Database } from "@/server/db/client";
import { categories, products } from "@/server/db/schema";
import { SLUG_PATTERN } from "@/lib/slug";
import { auditInsert, type AuditActor } from "./audit";
import { getCategoryTree } from "./catalog";

export const categoryInputSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN, "invalid_slug").max(80),
  parentId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  descriptionEn: z.string().trim().max(500).default(""),
  descriptionAr: z.string().trim().max(500).default(""),
  sortOrder: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(1000)),
  isActive: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()),
});

export async function saveCategory(db: Database, id: string | null, raw: unknown, actor: AuditActor) {
  const parsed = categoryInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const input = parsed.data;
  const tree = await getCategoryTree(db, { includeInactive: true });
  const bySlug = tree.bySlug.get(input.slug);
  if (bySlug && bySlug.id !== id) return { ok: false as const, error: "slug_taken" };
  if (input.parentId) {
    const parent = tree.byId.get(input.parentId);
    if (!parent) return { ok: false as const, error: "invalid_parent" };
    // Two levels keep navigation simple and prevent cycles.
    if (parent.parentId || parent.id === id) return { ok: false as const, error: "invalid_parent" };
    if (id && (tree.byId.get(id)?.children.length ?? 0) > 0) return { ok: false as const, error: "invalid_parent" };
  }
  const targetId = id ?? crypto.randomUUID();
  await runBatch(db, [
    id ? db.update(categories).set(input).where(eq(categories.id, id)) : db.insert(categories).values({ id: targetId, ...input }),
    auditInsert(db, actor, { action: id ? "category.updated" : "category.created", targetType: "category", targetId, metadata: { slug: input.slug } }),
  ]);
  return { ok: true as const, id: targetId };
}

export async function deleteCategory(db: Database, id: string, actor: AuditActor) {
  const tree = await getCategoryTree(db, { includeInactive: true });
  const node = tree.byId.get(id);
  if (!node) return { ok: false as const, error: "not_found" };
  if (node.children.length > 0) return { ok: false as const, error: "has_children" };
  if ((await db.$count(products, eq(products.categoryId, id))) > 0) return { ok: false as const, error: "has_products" };
  await runBatch(db, [
    db.delete(categories).where(eq(categories.id, id)),
    auditInsert(db, actor, { action: "category.deleted", targetType: "category", targetId: id, metadata: { slug: node.slug } }),
  ]);
  return { ok: true as const };
}

export async function categoryProductCounts(db: Database, opts: { publishedOnly?: boolean } = {}) {
  const rows = await db
    .select({ categoryId: products.categoryId })
    .from(products)
    .where(opts.publishedOnly ? eq(products.status, "PUBLISHED") : undefined);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.categoryId, (counts.get(r.categoryId) ?? 0) + 1);
  return counts;
}
