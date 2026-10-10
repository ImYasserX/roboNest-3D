import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type Database } from "@/server/db/client";
import { categories, productImages, products } from "@/server/db/schema";
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

export type CategoryShowcase = {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  /** Real number of published products (including subcategories). */
  productCount: number;
  /** Primary image of the most recently published product in the category, if any. */
  image: { key: string; altEn: string; altAr: string } | null;
  children: { id: string; slug: string; nameEn: string; nameAr: string; productCount: number }[];
};

/** Data for the categories page: real counts and real product imagery only. */
export async function getCategoryShowcase(db: Database): Promise<CategoryShowcase[]> {
  const tree = await getCategoryTree(db);
  const rows = await db
    .select({ id: products.id, categoryId: products.categoryId, publishedAt: products.publishedAt, createdAt: products.createdAt })
    .from(products)
    .where(eq(products.status, "PUBLISHED"))
    .orderBy(desc(products.publishedAt), desc(products.createdAt));
  const images = rows.length
    ? await db
        .select({ productId: productImages.productId, r2Key: productImages.r2Key, altEn: productImages.altEn, altAr: productImages.altAr, sortOrder: productImages.sortOrder })
        .from(productImages)
        .where(inArray(productImages.productId, rows.slice(0, 90).map((r) => r.id)))
        .orderBy(asc(productImages.sortOrder))
    : [];
  const primary = new Map<string, (typeof images)[number]>();
  for (const img of images) if (!primary.has(img.productId)) primary.set(img.productId, img);

  const countIn = (ids: Set<string>) => rows.filter((r) => ids.has(r.categoryId)).length;
  return tree.roots.map((root) => {
    const ids = new Set([root.id, ...root.children.map((c) => c.id)]);
    const withImage = rows.find((r) => ids.has(r.categoryId) && primary.has(r.id));
    const img = withImage ? primary.get(withImage.id)! : null;
    return {
      id: root.id,
      slug: root.slug,
      nameEn: root.nameEn,
      nameAr: root.nameAr,
      descriptionEn: root.descriptionEn,
      descriptionAr: root.descriptionAr,
      productCount: countIn(ids),
      image: img ? { key: img.r2Key, altEn: img.altEn, altAr: img.altAr } : null,
      children: root.children.map((c) => ({ id: c.id, slug: c.slug, nameEn: c.nameEn, nameAr: c.nameAr, productCount: countIn(new Set([c.id])) })),
    };
  });
}
