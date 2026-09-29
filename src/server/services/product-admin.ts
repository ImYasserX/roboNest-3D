import { and, asc, desc, eq, inArray, max, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { qualified } from "@/server/db/sql";
import { runBatch, type BatchStatement, type Database } from "@/server/db/client";
import {
  categories,
  digitalFiles,
  orderItems,
  productImages,
  productOptions,
  productOptionValues,
  productRelations,
  products,
} from "@/server/db/schema";
import {
  AVAILABILITY,
  MAX_PRICE_IQD,
  OPTION_TYPES,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  typeHasDigital,
} from "@/lib/domain";
import { SLUG_PATTERN } from "@/lib/slug";
import { escapeLike, normalizeSearchText } from "@/lib/search-normalize";
import { auditInsert, type AuditActor } from "./audit";

const noControl = (s: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);
const str = (max: number) => z.string().trim().max(max).refine(noControl, "invalid_characters");
const optionalInt = (min: number, maxValue: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(min).max(maxValue).nullable());
const money = optionalInt(0, MAX_PRICE_IQD);
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

/** "a, b, c" → ["a","b","c"] (trimmed, unique, bounded). */
const csvList = (maxItems: number, maxLen: number) =>
  z.preprocess(
    (v) =>
      typeof v === "string"
        ? [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))]
        : Array.isArray(v)
          ? v
          : [],
    z.array(z.string().max(maxLen).refine(noControl)).max(maxItems),
  );

/** One "English | العربية" pair per line. */
const bilingualLines = (maxItems: number) =>
  z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split("\n")
            .map((line) => line.split("|").map((s) => s.trim()))
            .filter((parts) => parts[0])
            .map(([en, ar]) => ({ en, ar: ar || en }))
        : (v ?? []),
    z.array(z.object({ en: z.string().max(200).refine(noControl), ar: z.string().max(200).refine(noControl) })).max(maxItems),
  );

/** "Label EN | Label AR | Value EN | Value AR" per line. */
const specLines = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split("\n")
          .map((line) => line.split("|").map((s) => s.trim()))
          .filter((p) => p[0] && p[2])
          .map(([le, la, ve, va]) => ({ label: { en: le, ar: la || le }, value: { en: ve, ar: va || ve } }))
      : (v ?? []),
  z
    .array(
      z.object({
        label: z.object({ en: z.string().max(80), ar: z.string().max(80) }),
        value: z.object({ en: z.string().max(200), ar: z.string().max(200) }),
      }),
    )
    .max(30),
);

export const productInputSchema = z
  .object({
    slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN, "invalid_slug").max(80),
    productType: z.enum(PRODUCT_TYPES),
    categoryId: z.string().uuid("category_required"),
    nameEn: str(120).pipe(z.string().min(2, "name_required")),
    nameAr: str(120).pipe(z.string().min(2, "name_required")),
    summaryEn: str(300).default(""),
    summaryAr: str(300).default(""),
    descriptionEn: z.string().trim().max(8000).default(""),
    descriptionAr: z.string().trim().max(8000).default(""),
    basePrice: z.preprocess((v) => Number(v), z.number().int("whole_dinars").min(0).max(MAX_PRICE_IQD)),
    salePrice: money,
    costPrice: money,
    availability: z.enum(AVAILABILITY),
    stockQuantity: optionalInt(0, 1_000_000),
    productionDaysMin: optionalInt(0, 180),
    productionDaysMax: optionalInt(0, 180),
    lengthMm: optionalInt(1, 10_000),
    widthMm: optionalInt(1, 10_000),
    heightMm: optionalInt(1, 10_000),
    weightGrams: optionalInt(1, 1_000_000),
    materials: csvList(15, 40),
    colors: csvList(30, 40),
    tags: csvList(30, 40),
    features: bilingualLines(20),
    included: bilingualLines(20),
    specifications: specLines,
    seoTitleEn: str(70).optional(),
    seoTitleAr: str(70).optional(),
    seoDescriptionEn: str(170).optional(),
    seoDescriptionAr: str(170).optional(),
    status: z.enum(PRODUCT_STATUSES),
    isFeatured: checkbox,
    relatedSlugs: csvList(8, 80),
  })
  .superRefine((v, ctx) => {
    if (v.salePrice !== null && v.salePrice >= v.basePrice) ctx.addIssue({ code: "custom", path: ["salePrice"], message: "sale_not_lower" });
    if (v.availability === "IN_STOCK" && v.stockQuantity === null) ctx.addIssue({ code: "custom", path: ["stockQuantity"], message: "stock_required" });
    if (v.productType === "DIGITAL" && v.availability !== "DIGITAL") ctx.addIssue({ code: "custom", path: ["availability"], message: "digital_availability" });
    if (v.productType !== "DIGITAL" && v.availability === "DIGITAL") ctx.addIssue({ code: "custom", path: ["availability"], message: "physical_availability" });
    if (v.productionDaysMin !== null && v.productionDaysMax !== null && v.productionDaysMin > v.productionDaysMax) {
      ctx.addIssue({ code: "custom", path: ["productionDaysMax"], message: "range_invalid" });
    }
  });

export type ProductInput = z.infer<typeof productInputSchema>;
export type FieldErrors = Record<string, string>;

function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

function buildSearchText(input: ProductInput, categoryNames: string[]) {
  return normalizeSearchText(
    [
      input.nameEn,
      input.nameAr,
      input.summaryEn,
      input.summaryAr,
      input.tags.join(" "),
      input.materials.join(" "),
      input.colors.join(" "),
      categoryNames.join(" "),
      input.descriptionEn.slice(0, 2000),
      input.descriptionAr.slice(0, 2000),
    ].join(" "),
  );
}

async function categoryNamesFor(db: Database, categoryId: string) {
  const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!cat) return null;
  const names = [cat.nameEn, cat.nameAr];
  if (cat.parentId) {
    const [parent] = await db.select().from(categories).where(eq(categories.id, cat.parentId)).limit(1);
    if (parent) names.push(parent.nameEn, parent.nameAr);
  }
  return names;
}

function toRow(input: ProductInput) {
  const { relatedSlugs: _r, ...rest } = input;
  void _r;
  return {
    ...rest,
    stockQuantity: input.availability === "IN_STOCK" ? input.stockQuantity : null,
    seoTitleEn: input.seoTitleEn || null,
    seoTitleAr: input.seoTitleAr || null,
    seoDescriptionEn: input.seoDescriptionEn || null,
    seoDescriptionAr: input.seoDescriptionAr || null,
  };
}

async function relationStatements(db: Database, productId: string, slugs: string[]) {
  const related = slugs.length
    ? await db.select({ id: products.id, slug: products.slug }).from(products).where(and(inArray(products.slug, slugs), ne(products.id, productId)))
    : [];
  const order = new Map(slugs.map((s, i) => [s, i]));
  return [
    db.delete(productRelations).where(eq(productRelations.productId, productId)),
    ...(related.length
      ? [db.insert(productRelations).values(related.map((r) => ({ productId, relatedProductId: r.id, sortOrder: order.get(r.slug) ?? 0 })))]
      : []),
  ];
}

export async function createProduct(db: Database, raw: unknown, actor: AuditActor) {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, errors: fieldErrors(parsed.error) };
  const input = parsed.data;
  const names = await categoryNamesFor(db, input.categoryId);
  if (!names) return { ok: false as const, errors: { categoryId: "category_required" } };
  const [taken] = await db.select({ id: products.id }).from(products).where(eq(products.slug, input.slug)).limit(1);
  if (taken) return { ok: false as const, errors: { slug: "slug_taken" } };

  const id = crypto.randomUUID();
  await runBatch(db, [
    db.insert(products).values({
      id,
      ...toRow(input),
      searchText: buildSearchText(input, names),
      publishedAt: input.status === "PUBLISHED" ? new Date() : null,
    }),
    ...(await relationStatements(db, id, input.relatedSlugs)),
    auditInsert(db, actor, { action: "product.created", targetType: "product", targetId: id, metadata: { slug: input.slug, basePrice: input.basePrice, status: input.status } }),
  ]);
  return { ok: true as const, id };
}

export async function updateProduct(db: Database, id: string, raw: unknown, actor: AuditActor) {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, errors: fieldErrors(parsed.error) };
  const input = parsed.data;
  const [current] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!current) return { ok: false as const, errors: { form: "not_found" } };
  const names = await categoryNamesFor(db, input.categoryId);
  if (!names) return { ok: false as const, errors: { categoryId: "category_required" } };
  const [taken] = await db.select({ id: products.id }).from(products).where(and(eq(products.slug, input.slug), ne(products.id, id))).limit(1);
  if (taken) return { ok: false as const, errors: { slug: "slug_taken" } };

  const statements: BatchStatement[] = [
    db
      .update(products)
      .set({
        ...toRow(input),
        searchText: buildSearchText(input, names),
        publishedAt: input.status === "PUBLISHED" ? (current.publishedAt ?? new Date()) : current.publishedAt,
      })
      .where(eq(products.id, id)),
    ...(await relationStatements(db, id, input.relatedSlugs)),
    auditInsert(db, actor, { action: "product.updated", targetType: "product", targetId: id, metadata: { slug: input.slug } }),
  ];
  if (current.basePrice !== input.basePrice || current.salePrice !== input.salePrice || current.costPrice !== input.costPrice) {
    statements.push(
      auditInsert(db, actor, {
        action: "product.price.changed",
        targetType: "product",
        targetId: id,
        metadata: {
          slug: input.slug,
          from: { base: current.basePrice, sale: current.salePrice, cost: current.costPrice },
          to: { base: input.basePrice, sale: input.salePrice, cost: input.costPrice },
        },
      }),
    );
  }
  if (current.status !== input.status) {
    statements.push(auditInsert(db, actor, { action: "product.status.changed", targetType: "product", targetId: id, metadata: { from: current.status, to: input.status } }));
  }
  if (current.stockQuantity !== toRow(input).stockQuantity || current.availability !== input.availability) {
    statements.push(
      auditInsert(db, actor, {
        action: "product.inventory.changed",
        targetType: "product",
        targetId: id,
        metadata: { from: { availability: current.availability, stock: current.stockQuantity }, to: { availability: input.availability, stock: toRow(input).stockQuantity } },
      }),
    );
  }
  await runBatch(db, statements);
  return { ok: true as const, id };
}

/** Quick inventory edit from the inventory screen. */
export async function updateInventory(db: Database, id: string, raw: unknown, actor: AuditActor) {
  const parsed = z
    .object({ availability: z.enum(AVAILABILITY), stockQuantity: optionalInt(0, 1_000_000) })
    .superRefine((v, ctx) => {
      if (v.availability === "IN_STOCK" && v.stockQuantity === null) ctx.addIssue({ code: "custom", path: ["stockQuantity"], message: "stock_required" });
    })
    .safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" as const };
  const [current] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!current) return { ok: false as const, error: "not_found" as const };
  if ((current.productType === "DIGITAL") !== (parsed.data.availability === "DIGITAL")) return { ok: false as const, error: "invalid_input" as const };
  const stock = parsed.data.availability === "IN_STOCK" ? parsed.data.stockQuantity : null;
  await runBatch(db, [
    db.update(products).set({ availability: parsed.data.availability, stockQuantity: stock }).where(eq(products.id, id)),
    auditInsert(db, actor, {
      action: "product.inventory.changed",
      targetType: "product",
      targetId: id,
      metadata: { slug: current.slug, from: { availability: current.availability, stock: current.stockQuantity }, to: { availability: parsed.data.availability, stock } },
    }),
  ]);
  return { ok: true as const };
}

export async function archiveProduct(db: Database, id: string, actor: AuditActor) {
  await runBatch(db, [
    db.update(products).set({ status: "ARCHIVED" }).where(eq(products.id, id)),
    auditInsert(db, actor, { action: "product.archived", targetType: "product", targetId: id }),
  ]);
  return { ok: true as const };
}

/**
 * Permanent deletion (Super Admin). Refused once the product has been
 * ordered: history must stay intact, so such products are archived instead.
 * Returns the R2 keys the caller must delete from storage.
 */
export async function deleteProduct(db: Database, id: string, actor: AuditActor) {
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!product) return { ok: false as const, error: "not_found" as const };
  const ordered = await db.$count(orderItems, eq(orderItems.productId, id));
  if (ordered > 0) return { ok: false as const, error: "has_orders" as const };
  const images = await db.select({ key: productImages.r2Key }).from(productImages).where(eq(productImages.productId, id));
  const files = await db.select({ key: digitalFiles.r2Key }).from(digitalFiles).where(eq(digitalFiles.productId, id));
  await runBatch(db, [
    db.delete(digitalFiles).where(eq(digitalFiles.productId, id)),
    db.delete(products).where(eq(products.id, id)),
    auditInsert(db, actor, { action: "product.deleted", targetType: "product", targetId: id, metadata: { slug: product.slug, nameEn: product.nameEn } }),
  ]);
  return {
    ok: true as const,
    mediaKeys: [...images.map((i) => i.key), ...(product.previewModelKey ? [product.previewModelKey] : [])],
    privateKeys: files.map((f) => f.key),
  };
}

// ---------------------------------------------------------------------------
// Listing and loading for the admin UI
// ---------------------------------------------------------------------------

export async function listProductsAdmin(db: Database, raw: Record<string, string | undefined>) {
  const query = z
    .object({
      q: z.string().trim().max(80).optional().catch(undefined),
      status: z.enum(PRODUCT_STATUSES).optional().catch(undefined),
      type: z.enum(PRODUCT_TYPES).optional().catch(undefined),
      availability: z.enum(AVAILABILITY).optional().catch(undefined),
      sort: z.enum(["updated", "name", "price_asc", "price_desc", "stock"]).optional().catch(undefined),
      page: z.preprocess((v) => Number(v ?? 1), z.number().int().min(1).max(10_000)).catch(1),
    })
    .parse(raw);
  const where: SQL[] = [];
  if (query.status) where.push(eq(products.status, query.status));
  if (query.type) where.push(eq(products.productType, query.type));
  if (query.availability) where.push(eq(products.availability, query.availability));
  if (query.q) {
    const pattern = `%${escapeLike(normalizeSearchText(query.q))}%`;
    where.push(sql`(${products.searchText} LIKE ${pattern} ESCAPE '\\' OR ${products.slug} LIKE ${`%${escapeLike(query.q.toLowerCase())}%`} ESCAPE '\\')`);
  }
  const condition = where.length ? and(...where) : undefined;
  const orderBy =
    query.sort === "name"
      ? asc(products.nameEn)
      : query.sort === "price_asc"
        ? asc(products.basePrice)
        : query.sort === "price_desc"
          ? desc(products.basePrice)
          : query.sort === "stock"
            ? asc(products.stockQuantity)
            : desc(products.updatedAt);
  const pageSize = 25;
  const total = await db.$count(products, condition);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, pageCount);
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      nameEn: products.nameEn,
      nameAr: products.nameAr,
      productType: products.productType,
      status: products.status,
      availability: products.availability,
      stockQuantity: products.stockQuantity,
      basePrice: products.basePrice,
      salePrice: products.salePrice,
      updatedAt: products.updatedAt,
      categoryNameEn: categories.nameEn,
      categoryNameAr: categories.nameAr,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(condition)
    .orderBy(orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageCount, query };
}

export async function getProductForEdit(db: Database, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!product) return null;
  const [images, options, files, related] = await Promise.all([
    db.select().from(productImages).where(eq(productImages.productId, id)).orderBy(asc(productImages.sortOrder), asc(productImages.createdAt)),
    db.select().from(productOptions).where(eq(productOptions.productId, id)).orderBy(asc(productOptions.sortOrder), asc(productOptions.createdAt)),
    db.select().from(digitalFiles).where(eq(digitalFiles.productId, id)).orderBy(desc(digitalFiles.createdAt)),
    db
      .select({ slug: products.slug })
      .from(productRelations)
      .innerJoin(products, eq(products.id, productRelations.relatedProductId))
      .where(eq(productRelations.productId, id))
      .orderBy(asc(productRelations.sortOrder)),
  ]);
  const values = options.length
    ? await db.select().from(productOptionValues).where(inArray(productOptionValues.optionId, options.map((o) => o.id))).orderBy(asc(productOptionValues.sortOrder))
    : [];
  return {
    product,
    images,
    options: options.map((o) => ({ ...o, values: values.filter((v) => v.optionId === o.id) })),
    files,
    relatedSlugs: related.map((r) => r.slug),
    acceptsDigitalFiles: typeHasDigital(product.productType),
  };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export const optionInputSchema = z
  .object({
    type: z.enum(OPTION_TYPES),
    labelEn: str(80).pipe(z.string().min(1)),
    labelAr: str(80).pipe(z.string().min(1)),
    helpEn: str(200).default(""),
    helpAr: str(200).default(""),
    isRequired: checkbox,
    priceDelta: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(MAX_PRICE_IQD)),
    pricePerUnit: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(1_000_000)),
    minValue: optionalInt(0, 1_000_000),
    maxValue: optionalInt(0, 1_000_000),
    unitEn: str(12).default(""),
    unitAr: str(12).default(""),
    sortOrder: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(1000)),
  })
  .superRefine((v, ctx) => {
    if (v.minValue !== null && v.maxValue !== null && v.minValue > v.maxValue) ctx.addIssue({ code: "custom", path: ["maxValue"], message: "range_invalid" });
    if ((v.type === "TEXT" || v.type === "TEXTAREA") && v.maxValue !== null && v.maxValue > 2000) ctx.addIssue({ code: "custom", path: ["maxValue"], message: "too_long" });
  });

async function productIdForOption(db: Database, optionId: string) {
  const [o] = await db.select({ productId: productOptions.productId }).from(productOptions).where(eq(productOptions.id, optionId)).limit(1);
  return o?.productId ?? null;
}

export async function saveOption(db: Database, productId: string, optionId: string | null, raw: unknown, actor: AuditActor) {
  const parsed = optionInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, errors: fieldErrors(parsed.error) };
  if (optionId) {
    if ((await productIdForOption(db, optionId)) !== productId) return { ok: false as const, errors: { form: "not_found" } };
    await runBatch(db, [
      db.update(productOptions).set(parsed.data).where(eq(productOptions.id, optionId)),
      auditInsert(db, actor, { action: "product.option.updated", targetType: "product", targetId: productId, metadata: { optionId, label: parsed.data.labelEn } }),
    ]);
    return { ok: true as const, id: optionId };
  }
  const [{ n }] = await db.select({ n: max(productOptions.sortOrder) }).from(productOptions).where(eq(productOptions.productId, productId));
  const id = crypto.randomUUID();
  await runBatch(db, [
    db.insert(productOptions).values({ id, productId, ...parsed.data, sortOrder: parsed.data.sortOrder || (n ?? 0) + 1 }),
    auditInsert(db, actor, { action: "product.option.created", targetType: "product", targetId: productId, metadata: { optionId: id, label: parsed.data.labelEn, type: parsed.data.type } }),
  ]);
  return { ok: true as const, id };
}

export async function deleteOption(db: Database, productId: string, optionId: string, actor: AuditActor) {
  if ((await productIdForOption(db, optionId)) !== productId) return { ok: false as const };
  await runBatch(db, [
    db.delete(productOptions).where(eq(productOptions.id, optionId)),
    auditInsert(db, actor, { action: "product.option.deleted", targetType: "product", targetId: productId, metadata: { optionId } }),
  ]);
  return { ok: true as const };
}

export const optionValueSchema = z.object({
  labelEn: str(60).pipe(z.string().min(1)),
  labelAr: str(60).pipe(z.string().min(1)),
  priceDelta: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(MAX_PRICE_IQD)),
  swatch: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()),
  isActive: checkbox,
  sortOrder: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(1000)),
});

export async function saveOptionValue(db: Database, productId: string, optionId: string, valueId: string | null, raw: unknown, actor: AuditActor) {
  if ((await productIdForOption(db, optionId)) !== productId) return { ok: false as const, errors: { form: "not_found" } };
  const parsed = optionValueSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, errors: fieldErrors(parsed.error) };
  const data = { ...parsed.data, swatch: parsed.data.swatch ?? null };
  if (valueId) {
    const res = await db
      .update(productOptionValues)
      .set(data)
      .where(and(eq(productOptionValues.id, valueId), eq(productOptionValues.optionId, optionId)))
      .returning({ id: productOptionValues.id });
    if (res.length !== 1) return { ok: false as const, errors: { form: "not_found" } };
  } else {
    await db.insert(productOptionValues).values({ optionId, ...data });
  }
  await auditInsert(db, actor, { action: valueId ? "product.optionValue.updated" : "product.optionValue.created", targetType: "product", targetId: productId, metadata: { optionId, label: data.labelEn, priceDelta: data.priceDelta } });
  return { ok: true as const };
}

export async function deleteOptionValue(db: Database, productId: string, optionId: string, valueId: string, actor: AuditActor) {
  if ((await productIdForOption(db, optionId)) !== productId) return { ok: false as const };
  await runBatch(db, [
    db.delete(productOptionValues).where(and(eq(productOptionValues.id, valueId), eq(productOptionValues.optionId, optionId))),
    auditInsert(db, actor, { action: "product.optionValue.deleted", targetType: "product", targetId: productId, metadata: { optionId, valueId } }),
  ]);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Images, preview model, digital files
// ---------------------------------------------------------------------------

export async function addProductImage(
  db: Database,
  productId: string,
  file: { key: string; width: number | null; height: number | null; filename: string },
  actor: AuditActor,
) {
  const [{ n }] = await db.select({ n: max(productImages.sortOrder) }).from(productImages).where(eq(productImages.productId, productId));
  const id = crypto.randomUUID();
  await runBatch(db, [
    db.insert(productImages).values({ id, productId, r2Key: file.key, width: file.width, height: file.height, sortOrder: (n ?? -1) + 1 }),
    auditInsert(db, actor, { action: "product.image.uploaded", targetType: "product", targetId: productId, metadata: { imageId: id, filename: file.filename } }),
  ]);
  return id;
}

export async function updateImageAlt(db: Database, productId: string, imageId: string, raw: unknown) {
  const parsed = z.object({ altEn: str(160), altAr: str(160) }).safeParse(raw);
  if (!parsed.success) return { ok: false as const };
  await db.update(productImages).set(parsed.data).where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)));
  return { ok: true as const };
}

/** Moves an image one step earlier/later; position 0 is the primary image. */
export async function moveImage(db: Database, productId: string, imageId: string, direction: "up" | "down" | "primary") {
  const images = await db.select().from(productImages).where(eq(productImages.productId, productId)).orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));
  const index = images.findIndex((i) => i.id === imageId);
  if (index === -1) return { ok: false as const };
  const reordered = [...images];
  const [item] = reordered.splice(index, 1);
  const target = direction === "primary" ? 0 : direction === "up" ? Math.max(0, index - 1) : Math.min(images.length - 1, index + 1);
  reordered.splice(target, 0, item);
  await runBatch(db, reordered.map((img, i) => db.update(productImages).set({ sortOrder: i }).where(eq(productImages.id, img.id))));
  return { ok: true as const };
}

export async function deleteProductImage(db: Database, productId: string, imageId: string, actor: AuditActor) {
  const [img] = await db.select().from(productImages).where(and(eq(productImages.id, imageId), eq(productImages.productId, productId))).limit(1);
  if (!img) return { ok: false as const };
  await runBatch(db, [
    db.delete(productImages).where(eq(productImages.id, imageId)),
    auditInsert(db, actor, { action: "product.image.deleted", targetType: "product", targetId: productId, metadata: { imageId } }),
  ]);
  return { ok: true as const, key: img.r2Key };
}

export async function setPreviewModel(db: Database, productId: string, key: string | null, actor: AuditActor) {
  const [current] = await db.select({ key: products.previewModelKey }).from(products).where(eq(products.id, productId)).limit(1);
  if (!current) return { ok: false as const };
  await runBatch(db, [
    db.update(products).set({ previewModelKey: key }).where(eq(products.id, productId)),
    auditInsert(db, actor, { action: key ? "product.preview.uploaded" : "product.preview.removed", targetType: "product", targetId: productId }),
  ]);
  return { ok: true as const, previousKey: current.key };
}

export async function addDigitalFile(
  db: Database,
  productId: string,
  file: { key: string; filename: string; extension: string; sizeBytes: number },
  actor: AuditActor & { adminId: string },
) {
  const format = file.extension.toUpperCase() as (typeof digitalFiles.$inferInsert)["format"];
  const id = crypto.randomUUID();
  await runBatch(db, [
    db.insert(digitalFiles).values({ id, productId, r2Key: file.key, filename: file.filename, format, sizeBytes: file.sizeBytes, uploadedBy: actor.adminId }),
    auditInsert(db, actor, { action: "digitalFile.uploaded", targetType: "product", targetId: productId, metadata: { fileId: id, filename: file.filename, sizeBytes: file.sizeBytes } }),
  ]);
  return id;
}

export async function setDigitalFileActive(db: Database, productId: string, fileId: string, active: boolean, actor: AuditActor) {
  const res = await db
    .update(digitalFiles)
    .set({ isActive: active })
    .where(and(eq(digitalFiles.id, fileId), eq(digitalFiles.productId, productId)))
    .returning({ id: digitalFiles.id });
  if (res.length !== 1) return { ok: false as const };
  await auditInsert(db, actor, { action: active ? "digitalFile.activated" : "digitalFile.deactivated", targetType: "product", targetId: productId, metadata: { fileId } });
  return { ok: true as const };
}

export async function deleteDigitalFile(db: Database, productId: string, fileId: string, actor: AuditActor) {
  const [file] = await db.select().from(digitalFiles).where(and(eq(digitalFiles.id, fileId), eq(digitalFiles.productId, productId))).limit(1);
  if (!file) return { ok: false as const };
  await runBatch(db, [
    db.delete(digitalFiles).where(eq(digitalFiles.id, fileId)),
    auditInsert(db, actor, { action: "digitalFile.deleted", targetType: "product", targetId: productId, metadata: { fileId, filename: file.filename } }),
  ]);
  return { ok: true as const, key: file.r2Key };
}

export async function listAllDigitalFiles(db: Database) {
  return db
    .select({
      id: digitalFiles.id,
      filename: digitalFiles.filename,
      format: digitalFiles.format,
      sizeBytes: digitalFiles.sizeBytes,
      isActive: digitalFiles.isActive,
      createdAt: digitalFiles.createdAt,
      productId: products.id,
      productNameEn: products.nameEn,
      productNameAr: products.nameAr,
      downloads: sql<number>`(SELECT COALESCE(SUM(${qualified(orderItems.downloadCount)}), 0) FROM ${orderItems} WHERE ${qualified(orderItems.productId)} = ${qualified(products.id)})`,
    })
    .from(digitalFiles)
    .innerJoin(products, eq(products.id, digitalFiles.productId))
    .orderBy(desc(digitalFiles.createdAt))
    .limit(200);
}

export async function productExists(db: Database, id: string) {
  if (!z.string().uuid().safeParse(id).success) return false;
  return (await db.$count(products, eq(products.id, id))) > 0;
}
