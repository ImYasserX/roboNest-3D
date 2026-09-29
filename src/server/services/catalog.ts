import { and, asc, desc, eq, gte, inArray, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { qualified } from "@/server/db/sql";
import { chunk, type Database } from "@/server/db/client";
import {
  categories,
  digitalFiles,
  orderItems,
  orders,
  productImages,
  productOptions,
  productOptionValues,
  productRelations,
  products,
} from "@/server/db/schema";
import { AVAILABILITY, PRODUCT_TYPES, type ProductType } from "@/lib/domain";
import { effectiveBasePrice, type PricingProduct } from "@/lib/pricing";
import { escapeLike, searchTerms } from "@/lib/search-normalize";

export const PAGE_SIZE = 24;

export const SORTS = ["relevance", "newest", "price_asc", "price_desc", "popular", "best_selling"] as const;
export type Sort = (typeof SORTS)[number];

const optionalInt = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : Number(v)),
  z.number().int().min(0).max(100_000_000).optional(),
);

/** Parses untrusted URL search params into a bounded, typed query. */
export const productQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  category: z.string().regex(/^[a-z0-9-]{1,80}$/).optional().catch(undefined),
  type: z.enum([...PRODUCT_TYPES, "physical", "digital"]).optional().catch(undefined),
  material: z.string().trim().max(40).optional().catch(undefined),
  availability: z.enum(AVAILABILITY).optional().catch(undefined),
  customizable: z.enum(["1"]).optional().catch(undefined),
  minPrice: optionalInt.catch(undefined),
  maxPrice: optionalInt.catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  page: z.preprocess((v) => Number(v ?? 1), z.number().int().min(1).max(500)).catch(1),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

export function parseProductQuery(params: Record<string, string | string[] | undefined>): ProductQuery {
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  return productQuerySchema.parse(flat);
}

const effectivePrice = sql<number>`CASE WHEN ${products.salePrice} IS NOT NULL AND ${products.salePrice} < ${products.basePrice} THEN ${products.salePrice} ELSE ${products.basePrice} END`;

const COUNTED_ORDER = sql`${qualified(orders.status)} NOT IN ('CANCELLED', 'RETURNED')`;

function salesSince(sinceMs: number | null) {
  const since = sinceMs === null ? sql`1 = 1` : sql`${qualified(orders.createdAt)} >= ${sinceMs}`;
  return sql<number>`COALESCE((SELECT SUM(${qualified(orderItems.quantity)}) FROM ${orderItems} INNER JOIN ${orders} ON ${qualified(orders.id)} = ${qualified(orderItems.orderId)} WHERE ${qualified(orderItems.productId)} = ${qualified(products.id)} AND ${COUNTED_ORDER} AND ${since}), 0)`;
}

export type CategoryNode = {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  children: CategoryNode[];
};

export async function getCategoryTree(db: Database, opts: { includeInactive?: boolean } = {}) {
  const rows = await db
    .select()
    .from(categories)
    .where(opts.includeInactive ? undefined : eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder), asc(categories.nameEn));
  const nodes = new Map<string, CategoryNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else if (!node.parentId) roots.push(node);
  }
  return { roots, byId: nodes, bySlug: new Map([...nodes.values()].map((n) => [n.slug, n])) };
}

function descendantIds(node: CategoryNode): string[] {
  return [node.id, ...node.children.flatMap(descendantIds)];
}

export type ProductCard = {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  summaryEn: string;
  summaryAr: string;
  productType: ProductType;
  availability: (typeof AVAILABILITY)[number];
  stockQuantity: number | null;
  basePrice: number;
  salePrice: number | null;
  price: number;
  productionDaysMin: number | null;
  productionDaysMax: number | null;
  isCustomizable: boolean;
  image: { key: string; altEn: string; altAr: string; width: number | null; height: number | null } | null;
  hasPreview: boolean;
};

const cardColumns = {
  id: products.id,
  slug: products.slug,
  nameEn: products.nameEn,
  nameAr: products.nameAr,
  summaryEn: products.summaryEn,
  summaryAr: products.summaryAr,
  productType: products.productType,
  availability: products.availability,
  stockQuantity: products.stockQuantity,
  basePrice: products.basePrice,
  salePrice: products.salePrice,
  productionDaysMin: products.productionDaysMin,
  productionDaysMax: products.productionDaysMax,
  previewModelKey: products.previewModelKey,
  optionCount: sql<number>`(SELECT COUNT(*) FROM ${productOptions} WHERE ${qualified(productOptions.productId)} = ${qualified(products.id)})`,
};

type CardRow = { [K in keyof typeof cardColumns]: unknown } & Record<string, unknown>;

async function toCards(db: Database, rows: CardRow[]): Promise<ProductCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as string);
  const images = await db
    .select()
    .from(productImages)
    .where(inArray(productImages.productId, ids))
    .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));
  const primary = new Map<string, (typeof images)[number]>();
  for (const img of images) if (!primary.has(img.productId)) primary.set(img.productId, img);
  return rows.map((r) => {
    const img = primary.get(r.id as string);
    const base = { basePrice: r.basePrice as number, salePrice: r.salePrice as number | null };
    return {
      id: r.id as string,
      slug: r.slug as string,
      nameEn: r.nameEn as string,
      nameAr: r.nameAr as string,
      summaryEn: r.summaryEn as string,
      summaryAr: r.summaryAr as string,
      productType: r.productType as ProductType,
      availability: r.availability as ProductCard["availability"],
      stockQuantity: r.stockQuantity as number | null,
      ...base,
      price: effectiveBasePrice(base),
      productionDaysMin: r.productionDaysMin as number | null,
      productionDaysMax: r.productionDaysMax as number | null,
      isCustomizable: Number(r.optionCount) > 0 || r.productType === "CUSTOMIZABLE",
      hasPreview: Boolean(r.previewModelKey),
      image: img ? { key: img.r2Key, altEn: img.altEn, altAr: img.altAr, width: img.width, height: img.height } : null,
    };
  });
}

export async function listProducts(db: Database, query: ProductQuery, opts: { pageSize?: number } = {}) {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const where: SQL[] = [eq(products.status, "PUBLISHED")];
  let categoryNode: CategoryNode | undefined;

  if (query.category) {
    const tree = await getCategoryTree(db);
    categoryNode = tree.bySlug.get(query.category);
    if (!categoryNode) return { items: [], total: 0, page: 1, pageCount: 0, category: undefined };
    where.push(inArray(products.categoryId, descendantIds(categoryNode)));
  }
  if (query.type === "digital") where.push(inArray(products.productType, ["DIGITAL", "PHYSICAL_DIGITAL"]));
  else if (query.type === "physical") where.push(ne(products.productType, "DIGITAL"));
  else if (query.type) where.push(eq(products.productType, query.type));
  if (query.availability) where.push(eq(products.availability, query.availability));
  if (query.material) {
    where.push(sql`EXISTS (SELECT 1 FROM json_each(${qualified(products.materials)}) WHERE lower(json_each.value) = lower(${query.material}))`);
  }
  if (query.customizable) {
    where.push(
      or(
        eq(products.productType, "CUSTOMIZABLE"),
        sql`EXISTS (SELECT 1 FROM ${productOptions} WHERE ${qualified(productOptions.productId)} = ${qualified(products.id)})`,
      )!,
    );
  }
  if (query.minPrice !== undefined) where.push(gte(effectivePrice, query.minPrice));
  if (query.maxPrice !== undefined) where.push(lte(effectivePrice, query.maxPrice));

  const terms = query.q ? searchTerms(query.q) : [];
  for (const term of terms) {
    where.push(sql`${products.searchText} LIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'`);
  }

  const sort: Sort = query.sort ?? (terms.length > 0 ? "relevance" : "newest");
  let orderBy: SQL[];
  switch (sort) {
    case "price_asc":
      orderBy = [asc(effectivePrice), desc(products.createdAt)];
      break;
    case "price_desc":
      orderBy = [desc(effectivePrice), desc(products.createdAt)];
      break;
    case "popular":
      orderBy = [desc(salesSince(Date.now() - 30 * 86_400_000)), desc(products.isFeatured), desc(products.createdAt)];
      break;
    case "best_selling":
      orderBy = [desc(salesSince(null)), desc(products.createdAt)];
      break;
    case "relevance": {
      if (terms.length === 0) {
        orderBy = [desc(products.isFeatured), desc(products.createdAt)];
        break;
      }
      const first = `%${escapeLike(terms[0])}%`;
      // Name matches rank above tag matches, which rank above description matches.
      orderBy = [
        desc(sql`(CASE WHEN lower(${products.nameEn}) LIKE ${first} ESCAPE '\\' OR ${products.nameAr} LIKE ${first} ESCAPE '\\' THEN 4 ELSE 0 END) + (CASE WHEN lower(${products.tags}) LIKE ${first} ESCAPE '\\' THEN 2 ELSE 0 END)`),
        desc(products.createdAt),
      ];
      break;
    }
    default:
      orderBy = [desc(products.createdAt)];
  }

  const condition = and(...where);
  const [{ total }] = await db.select({ total: sql<number>`COUNT(*)` }).from(products).where(condition);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, pageCount);
  const rows = await db
    .select(cardColumns)
    .from(products)
    .where(condition)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items: await toCards(db, rows), total, page, pageCount, category: categoryNode, sort };
}

/** Filter facets derived from published products (no fake options). */
export async function getFacets(db: Database) {
  const materials = await db.all<{ value: string }>(
    sql`SELECT DISTINCT json_each.value AS value FROM ${products}, json_each(${products.materials}) WHERE ${products.status} = 'PUBLISHED' ORDER BY value LIMIT 50`,
  );
  const [range] = await db
    .select({ min: sql<number>`MIN(${effectivePrice})`, max: sql<number>`MAX(${effectivePrice})` })
    .from(products)
    .where(eq(products.status, "PUBLISHED"));
  return { materials: materials.map((m) => m.value), minPrice: range?.min ?? 0, maxPrice: range?.max ?? 0 };
}

export async function getHomeCollections(db: Database) {
  const published = eq(products.status, "PUBLISHED");
  const [featured, latest, popular, models] = await Promise.all([
    db.select(cardColumns).from(products).where(and(published, eq(products.isFeatured, true))).orderBy(desc(products.updatedAt)).limit(8),
    db.select(cardColumns).from(products).where(published).orderBy(desc(products.publishedAt), desc(products.createdAt)).limit(8),
    db
      .select({ ...cardColumns, sold: salesSince(Date.now() - 90 * 86_400_000) })
      .from(products)
      .where(published)
      .orderBy(desc(salesSince(Date.now() - 90 * 86_400_000)), desc(products.createdAt))
      .limit(8),
    db
      .select(cardColumns)
      .from(products)
      .where(and(published, inArray(products.productType, ["DIGITAL", "PHYSICAL_DIGITAL"])))
      .orderBy(desc(products.createdAt))
      .limit(4),
  ]);
  const hasSales = popular.some((p) => Number(p.sold) > 0);
  return {
    featured: await toCards(db, featured),
    latest: await toCards(db, latest),
    // Only show "popular" when real sales exist; never fabricate popularity.
    popular: hasSales ? await toCards(db, popular.filter((p) => Number(p.sold) > 0)) : [],
    models: await toCards(db, models),
  };
}

export async function getProductCardsByIds(db: Database, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select(cardColumns)
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.status, "PUBLISHED")));
  const cards = await toCards(db, rows);
  const order = new Map(ids.map((id, i) => [id, i]));
  return cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Loads a product with its options in the shape the pricing engine expects. */
export async function loadPricingProducts(db: Database, ids: string[]): Promise<Map<string, PricingProduct & { row: typeof products.$inferSelect }>> {
  const result = new Map<string, PricingProduct & { row: typeof products.$inferSelect }>();
  if (ids.length === 0) return result;
  const rows = await db.select().from(products).where(inArray(products.id, ids));
  const opts = await db
    .select()
    .from(productOptions)
    .where(inArray(productOptions.productId, ids))
    .orderBy(asc(productOptions.sortOrder), asc(productOptions.createdAt));
  const vals = (
    await Promise.all(
      chunk(opts.map((o) => o.id)).map((ids) =>
        db.select().from(productOptionValues).where(inArray(productOptionValues.optionId, ids)).orderBy(asc(productOptionValues.sortOrder)),
      ),
    )
  ).flat();
  for (const row of rows) {
    result.set(row.id, {
      id: row.id,
      productType: row.productType,
      status: row.status,
      availability: row.availability,
      stockQuantity: row.stockQuantity,
      basePrice: row.basePrice,
      salePrice: row.salePrice,
      row,
      options: opts
        .filter((o) => o.productId === row.id)
        .map((o) => ({
          id: o.id,
          type: o.type,
          labelEn: o.labelEn,
          labelAr: o.labelAr,
          isRequired: o.isRequired,
          priceDelta: o.priceDelta,
          pricePerUnit: o.pricePerUnit,
          minValue: o.minValue,
          maxValue: o.maxValue,
          unitEn: o.unitEn,
          unitAr: o.unitAr,
          values: vals
            .filter((v) => v.optionId === o.id)
            .map((v) => ({ id: v.id, labelEn: v.labelEn, labelAr: v.labelAr, priceDelta: v.priceDelta, isActive: v.isActive })),
        })),
    });
  }
  return result;
}

export async function getProductBySlug(db: Database, slug: string, opts: { includeUnpublished?: boolean } = {}) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [row] = await db
    .select()
    .from(products)
    .where(opts.includeUnpublished ? eq(products.slug, slug) : and(eq(products.slug, slug), eq(products.status, "PUBLISHED")))
    .limit(1);
  if (!row) return null;

  const [images, optionRows, category, files] = await Promise.all([
    db.select().from(productImages).where(eq(productImages.productId, row.id)).orderBy(asc(productImages.sortOrder), asc(productImages.createdAt)),
    db.select().from(productOptions).where(eq(productOptions.productId, row.id)).orderBy(asc(productOptions.sortOrder), asc(productOptions.createdAt)),
    db.select().from(categories).where(eq(categories.id, row.categoryId)).limit(1),
    db
      .select({ format: digitalFiles.format, sizeBytes: digitalFiles.sizeBytes })
      .from(digitalFiles)
      .where(and(eq(digitalFiles.productId, row.id), eq(digitalFiles.isActive, true))),
  ]);
  const values = optionRows.length
    ? await db
        .select()
        .from(productOptionValues)
        .where(and(inArray(productOptionValues.optionId, optionRows.map((o) => o.id)), eq(productOptionValues.isActive, true)))
        .orderBy(asc(productOptionValues.sortOrder))
    : [];
  const cat = category[0] ?? null;
  const parent = cat?.parentId
    ? (await db.select().from(categories).where(eq(categories.id, cat.parentId)).limit(1))[0] ?? null
    : null;

  return {
    product: row,
    price: effectiveBasePrice(row),
    images,
    options: optionRows.map((o) => ({ ...o, values: values.filter((v) => v.optionId === o.id) })),
    category: cat,
    parentCategory: parent,
    digitalFormats: [...new Set(files.map((f) => f.format))],
  };
}

export async function getRelatedProducts(db: Database, productId: string, categoryId: string, limit = 4) {
  const explicit = await db
    .select({ id: productRelations.relatedProductId })
    .from(productRelations)
    .where(eq(productRelations.productId, productId))
    .orderBy(asc(productRelations.sortOrder))
    .limit(limit);
  const ids = explicit.map((r) => r.id);
  if (ids.length < limit) {
    const fill = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.categoryId, categoryId),
          eq(products.status, "PUBLISHED"),
          notInArray(products.id, [productId, ...ids]),
        ),
      )
      .orderBy(desc(products.createdAt))
      .limit(limit - ids.length);
    ids.push(...fill.map((r) => r.id));
  }
  return getProductCardsByIds(db, ids);
}

export async function listPublishedSlugs(db: Database) {
  return db
    .select({ slug: products.slug, updatedAt: products.updatedAt })
    .from(products)
    .where(eq(products.status, "PUBLISHED"));
}
