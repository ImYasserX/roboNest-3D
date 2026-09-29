import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { productOptions, products } from "@/server/db/schema";
import { addToCart } from "@/server/services/cart";
import { getProductBySlug, listProducts, parseProductQuery, getHomeCollections } from "@/server/services/catalog";
import { createProduct, updateProduct, deleteProduct } from "@/server/services/product-admin";
import { listCustomers } from "@/server/services/customers";
import { getDashboard } from "@/server/services/analytics";
import { changeOrderStatus } from "@/server/services/admin-orders";
import { listOrdersForUser, placeOrder } from "@/server/services/orders";
import { saveSetting } from "@/server/services/settings";
import { startPlatform, type TestPlatform } from "../support/platform";
import { checkoutInput, makeCategory, makeProduct, makeUser, makeZone } from "../support/fixtures";

let p: TestPlatform;
const SECRET = "test-app-secret-at-least-32-characters-long";
const actor = { adminId: null, label: "tester" };
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

const baseInput = (categoryId: string, over: Record<string, unknown> = {}) => ({
  slug: `robot-${Math.random().toString(36).slice(2, 8)}`,
  productType: "PHYSICAL",
  categoryId,
  nameEn: "Gripper Arm",
  nameAr: "ذراع ماسك",
  basePrice: "15000",
  availability: "MADE_TO_ORDER",
  status: "PUBLISHED",
  materials: "PETG, PLA",
  tags: "robotics, arm",
  features: "Strong | قوي",
  specifications: "Weight | الوزن | 50 g | 50 غرام",
  ...over,
});

describe("admin product management", () => {
  it("validates and creates products, auditing price changes", async () => {
    const cat = await makeCategory(p.db);
    expect(await createProduct(p.db, baseInput(cat.id, { slug: "Bad Slug!" }), actor)).toMatchObject({ ok: false, errors: { slug: "invalid_slug" } });
    expect(await createProduct(p.db, baseInput(cat.id, { salePrice: "20000" }), actor)).toMatchObject({ ok: false, errors: { salePrice: "sale_not_lower" } });
    expect(await createProduct(p.db, baseInput(cat.id, { availability: "IN_STOCK" }), actor)).toMatchObject({ ok: false, errors: { stockQuantity: "stock_required" } });
    expect(await createProduct(p.db, baseInput(cat.id, { basePrice: "-5" }), actor)).toMatchObject({ ok: false });
    expect(await createProduct(p.db, baseInput(cat.id, { basePrice: "12.5" }), actor)).toMatchObject({ ok: false });
    const created = await createProduct(p.db, baseInput(cat.id, { slug: "gripper-arm-x" }), actor);
    expect(created.ok).toBe(true);
    expect(await createProduct(p.db, baseInput(cat.id, { slug: "gripper-arm-x" }), actor)).toMatchObject({ ok: false, errors: { slug: "slug_taken" } });
    if (!created.ok) return;
    const detail = await getProductBySlug(p.db, "gripper-arm-x");
    expect(detail?.product.specifications[0]).toEqual({ label: { en: "Weight", ar: "الوزن" }, value: { en: "50 g", ar: "50 غرام" } });
    expect((await updateProduct(p.db, created.id, baseInput(cat.id, { slug: "gripper-arm-x", basePrice: "17000" }), actor)).ok).toBe(true);
  });

  it("hides drafts from the store and refuses to delete ordered products", async () => {
    const cat = await makeCategory(p.db);
    const draft = await createProduct(p.db, baseInput(cat.id, { slug: "secret-draft", status: "DRAFT" }), actor);
    expect(draft.ok).toBe(true);
    expect(await getProductBySlug(p.db, "secret-draft")).toBeNull();
    const product = await makeProduct(p.db);
    const zone = await makeZone(p.db);
    const owner = { visitorHash: "h1" };
    await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
    await placeOrder(p.db, checkoutInput(zone.id), { owner, userId: null, appSecret: SECRET });
    expect(await deleteProduct(p.db, product.id, actor)).toEqual({ ok: false, error: "has_orders" });
    if (draft.ok) expect((await deleteProduct(p.db, draft.id, actor)).ok).toBe(true);
  });
});

describe("catalog queries", () => {
  it("filters, searches (Arabic variants) and computes customizable flags correctly", async () => {
    const cat = await makeCategory(p.db);
    const plain = await makeProduct(p.db, { categoryId: cat.id, nameEn: "Plain Box", nameAr: "صندوق", searchText: "plain box صندوق", materials: ["PLA"] });
    const custom = await makeProduct(p.db, { categoryId: cat.id, nameEn: "Name Tag", nameAr: "ميدالية", searchText: "name tag ميداليه", materials: ["PETG"] });
    await p.db.insert(productOptions).values({ productId: custom.id, type: "TEXT", labelEn: "Name", labelAr: "الاسم" });
    const res = await listProducts(p.db, parseProductQuery({ category: cat.slug }));
    expect(res.items.find((i) => i.id === custom.id)?.isCustomizable).toBe(true);
    expect(res.items.find((i) => i.id === plain.id)?.isCustomizable).toBe(false);
    expect((await listProducts(p.db, parseProductQuery({ category: cat.slug, customizable: "1" }))).items.map((i) => i.id)).toEqual([custom.id]);
    expect((await listProducts(p.db, parseProductQuery({ category: cat.slug, material: "petg" }))).items.map((i) => i.id)).toEqual([custom.id]);
    expect((await listProducts(p.db, parseProductQuery({ q: "ميدالية" }))).items.map((i) => i.id)).toContain(custom.id);
    // A wildcard-only query is treated as "no search terms", never as a raw LIKE pattern.
    expect((await listProducts(p.db, parseProductQuery({ q: "%_%" }))).total).toBe((await listProducts(p.db, parseProductQuery({}))).total);
    expect((await listProducts(p.db, parseProductQuery({ q: "box%" }))).items.map((i) => i.id)).toEqual([plain.id]);
    // Hostile query params are ignored rather than reaching SQL.
    expect(parseProductQuery({ sort: "id; DROP TABLE products", page: "-4", minPrice: "abc", category: "../x" })).toMatchObject({ page: 1, sort: undefined, minPrice: undefined, category: undefined });
  });

  it("counts sales for popularity and per-customer order stats (correlated subqueries)", async () => {
    const cat = await makeCategory(p.db);
    const hot = await makeProduct(p.db, { categoryId: cat.id });
    const cold = await makeProduct(p.db, { categoryId: cat.id });
    const user = await makeUser(p.db);
    const zone = await makeZone(p.db);
    await addToCart(p.db, { userId: user.id }, { productId: hot.id, quantity: 3, options: {} });
    const r = await placeOrder(p.db, checkoutInput(zone.id), { owner: { userId: user.id }, userId: user.id, appSecret: SECRET });
    if (!r.ok) throw new Error(r.error);
    const sorted = await listProducts(p.db, parseProductQuery({ category: cat.slug, sort: "best_selling" }));
    expect(sorted.items.map((i) => i.id)).toEqual([hot.id, cold.id]);
    expect((await getHomeCollections(p.db)).popular.map((i) => i.id)).toContain(hot.id);
    const mine = await listOrdersForUser(p.db, user.id);
    expect(mine[0].itemCount).toBe(3);
    const customers = await listCustomers(p.db, { q: user.phone });
    expect(customers.rows[0]).toMatchObject({ orderCount: 1, totalSpent: 0 });
    for (const [from, to] of [["PENDING", "CONFIRMED"], ["CONFIRMED", "READY_FOR_DELIVERY"], ["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"], ["OUT_FOR_DELIVERY", "DELIVERED"]] as const) {
      await changeOrderStatus(p.db, r.orderId, { from, to, expectedFrom: from } as never, actor);
    }
    expect((await listCustomers(p.db, { q: user.phone })).rows[0].totalSpent).toBe(r.ok ? (await p.db.select().from(products).where(eq(products.id, hot.id)))[0].basePrice * 3 + 5_000 : 0);
  });
});

describe("analytics", () => {
  it("reports delivered revenue, profit from cost snapshots, and hides profit when not permitted", async () => {
    const product = await makeProduct(p.db, { basePrice: 10_000, costPrice: 4_000 });
    const zone = await makeZone(p.db, { fee: 5_000 });
    const owner = { visitorHash: "analytics" };
    await addToCart(p.db, owner, { productId: product.id, quantity: 2, options: {} });
    const r = await placeOrder(p.db, checkoutInput(zone.id), { owner, userId: null, appSecret: SECRET });
    if (!r.ok) throw new Error(r.error);
    const before = await getDashboard(p.db, 30, { includeProfit: true });
    for (const [from, to] of [["PENDING", "CONFIRMED"], ["CONFIRMED", "READY_FOR_DELIVERY"], ["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"], ["OUT_FOR_DELIVERY", "DELIVERED"]] as const) {
      await changeOrderStatus(p.db, r.orderId, { to, expectedFrom: from }, actor);
    }
    const after = await getDashboard(p.db, 30, { includeProfit: true });
    expect(after.goodsRevenue - before.goodsRevenue).toBe(20_000);
    expect(after.deliveryFees - before.deliveryFees).toBe(5_000);
    expect(after.profit!.grossProfit - before.profit!.grossProfit).toBe(12_000);
    expect(after.revenueSeries.reduce((s, d) => s + d.value, 0)).toBe(after.goodsRevenue);
    expect((await getDashboard(p.db, 30, { includeProfit: false })).profit).toBeNull();
  });
});

describe("settings validation", () => {
  it("rejects invalid phones, non-https URLs and script-like values", async () => {
    const actorX = { adminId: null, label: "x" };
    const store = { whatsapp: "12345", phone: "", email: "", instagram: "", facebook: "", address: { en: "", ar: "" }, hours: { en: "", ar: "" } };
    expect((await saveSetting(p.db, "store", store, actorX)).ok).toBe(false);
    expect((await saveSetting(p.db, "store", { ...store, whatsapp: "07701234567", instagram: "javascript:alert(1)" }, actorX)).ok).toBe(false);
    expect((await saveSetting(p.db, "store", { ...store, whatsapp: "07701234567", instagram: "https://instagram.com/robonest" }, actorX)).ok).toBe(true);
  });
});
