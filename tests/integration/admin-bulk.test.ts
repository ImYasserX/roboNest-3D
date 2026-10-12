import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { auditLogs, digitalFiles, orderItems, orders, previewModels, products } from "@/server/db/schema";
import { addToCart } from "@/server/services/cart";
import { placeOrder } from "@/server/services/orders";
import { authorizeDownload } from "@/server/services/downloads";
import { listProductsAdmin } from "@/server/services/product-admin";
import { bulkDeleteProducts, bulkUpdateProducts, previewBulkDelete, resolveSelection } from "@/server/services/product-bulk";
import { bulkDeleteDigitalFiles, bulkSetDigitalFilesActive, listDigitalFilesAdmin, renameDigitalFile } from "@/server/services/digital-file-admin";
import { findServablePreview } from "@/server/services/previews";
import { PUBLIC_MEDIA_KEY } from "@/server/storage/file-rules";
import { hasPermission } from "@/lib/permissions";
import { startPlatform, type TestPlatform } from "../support/platform";
import { makeCategory, makeProduct, makeUser } from "../support/fixtures";
import { confirmDue } from "../support/payments";

let p: TestPlatform;
const SECRET = "test-app-secret-at-least-32-characters-long";
const actor = { adminId: null, label: "test admin" };
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

const row = async (id: string) => (await p.db.select().from(products).where(eq(products.id, id)))[0];

async function buy(productId: string) {
  const buyer = await makeUser(p.db);
  await addToCart(p.db, { userId: buyer.id }, { productId, quantity: 1, options: {} });
  const r = await placeOrder(p.db, { idempotencyKey: crypto.randomUUID(), fullName: "Buyer", phone: "07501234567", locale: "en" }, { owner: { userId: buyer.id }, userId: buyer.id, appSecret: SECRET });
  if (!r.ok) throw new Error(r.error);
  const [item] = await p.db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId));
  return { ...r, buyer, item };
}

describe("product search, filters and selection", () => {
  it("filters by category (including sub-categories), material and status, and resolves 'all matching' on the server", async () => {
    const cat = await makeCategory(p.db);
    const tag = `bulk${crypto.randomUUID().replace(/[^a-f]/g, "").slice(0, 8)}`;
    const a = await makeProduct(p.db, { categoryId: cat.id, materials: ["PETG"], nameEn: `Alpha ${tag}`, searchText: `alpha ${tag}` });
    const b = await makeProduct(p.db, { categoryId: cat.id, materials: ["PLA"], nameEn: `Beta ${tag}`, searchText: `beta ${tag}`, status: "DRAFT" });
    const list = await listProductsAdmin(p.db, { category: cat.id, material: "petg" });
    expect(list.rows.map((r) => r.id)).toEqual([a.id]);
    expect((await listProductsAdmin(p.db, { q: tag, status: "DRAFT" })).rows.map((r) => r.id)).toEqual([b.id]);
    // "All matching" is resolved from the filter, not from a client-sent list.
    const sel = await resolveSelection(p.db, { mode: "filter", filter: { q: tag } });
    expect(sel.ok && sel.ids.sort()).toEqual([a.id, b.id].sort());
    expect(await resolveSelection(p.db, { mode: "ids", ids: ["not-a-uuid"] })).toEqual({ ok: false, error: "invalid_selection" });
    expect(await resolveSelection(p.db, { mode: "ids", ids: [crypto.randomUUID()] })).toEqual({ ok: false, error: "invalid_selection" });
  });
});

describe("bulk editing", () => {
  it("changes only the explicitly chosen fields", async () => {
    const a = await makeProduct(p.db, { basePrice: 10_000, salePrice: 8_000, tags: ["gear"], materials: ["PLA"], status: "DRAFT", descriptionEn: "Keep me" });
    const b = await makeProduct(p.db, { basePrice: 21_000, tags: [], materials: ["PETG"], status: "DRAFT" });
    const before = await row(a.id);
    const res = await bulkUpdateProducts(p.db, { mode: "ids", ids: [a.id, b.id] }, { status: "PUBLISHED", addTags: ["new"], pricePercent: 10 }, actor);
    expect(res).toMatchObject({ ok: true, selected: 2, updated: 2 });
    const after = await row(a.id);
    expect(after).toMatchObject({ status: "PUBLISHED", basePrice: 11_000, salePrice: 8_800, tags: ["gear", "new"], materials: ["PLA"], descriptionEn: "Keep me", categoryId: before.categoryId, availability: before.availability, nameEn: before.nameEn });
    expect(after.publishedAt).not.toBeNull();
    expect(after.searchText).toContain("new");
    expect((await row(b.id)).basePrice).toBe(23_100);
    const [log] = await p.db.select().from(auditLogs).where(eq(auditLogs.action, "product.bulk_updated"));
    expect(JSON.stringify(log.metadata)).toContain(a.id);
  });

  it("is all-or-nothing: one invalid product means nothing changes", async () => {
    const ok = await makeProduct(p.db, { basePrice: 10_000 });
    const digital = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL", basePrice: 10_000 });
    const res = await bulkUpdateProducts(p.db, { mode: "ids", ids: [ok.id, digital.id] }, { availability: "MADE_TO_ORDER" }, actor);
    expect(res).toMatchObject({ ok: false, error: "validation_failed", problems: [{ id: digital.id, error: "digital_availability" }] });
    expect((await row(ok.id)).availability).toBe("MADE_TO_ORDER"); // unchanged default
    expect((await row(digital.id)).availability).toBe("DIGITAL");
    expect(await bulkUpdateProducts(p.db, { mode: "ids", ids: [ok.id] }, { availability: "IN_STOCK" }, actor)).toMatchObject({ ok: false, problems: [{ error: "stock_required" }] });
    expect(await bulkUpdateProducts(p.db, { mode: "ids", ids: [ok.id] }, {}, actor)).toEqual({ ok: false, error: "invalid_input" });
    expect(await bulkUpdateProducts(p.db, { mode: "ids", ids: [ok.id] }, { pricePercent: 0 }, actor)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("bulk operations need products.edit / products.delete; Operations cannot delete", () => {
    expect(hasPermission("OPERATIONS", "products.edit")).toBe(true);
    expect(hasPermission("OPERATIONS", "products.delete")).toBe(false);
    const actions = readFileSync("src/server/actions/admin/products.ts", "utf8");
    expect(actions).toMatch(/withAdmin\("products\.edit", \(\{ db, actor \}\) => bulkUpdateProducts\(/);
    expect(actions).toMatch(/withAdmin\("products\.delete", async \(\{ db, actor \}\) => \{\s*const result = await bulkDeleteProducts\(/);
    expect(actions).toMatch(/withAdmin\("products\.delete", \(\{ db \}\) => previewBulkDelete\(/);
    expect(actions).toMatch(/confirmText.*DELETE/);
  });
});

describe("bulk deletion keeps history and entitlements", () => {
  it("deletes never-ordered products, archives ordered ones, and buyers keep their paid downloads", async () => {
    const unsold = await makeProduct(p.db);
    const sold = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL", basePrice: 9_000 });
    const [file] = await p.db.insert(digitalFiles).values({ productId: sold.id, r2Key: `digital/2026/10/${crypto.randomUUID()}.stl`, filename: "paid.stl", format: "STL", sizeBytes: 84 }).returning();
    const key = `preview-proxies/2026/10/${crypto.randomUUID()}.glb`;
    await p.db.insert(previewModels).values({ productId: sold.id, r2Key: key, status: "APPROVED", source: "UPLOADED", sha256: crypto.randomUUID(), sizeBytes: 1, triangleCount: 1, vertexCount: 3, reviewedAt: new Date() });
    const purchase = await buy(sold.id);
    await confirmDue(p.db, purchase.orderId);

    const plan = await previewBulkDelete(p.db, { mode: "ids", ids: [unsold.id, sold.id] });
    expect(plan.ok && plan.items.find((i) => i.id === sold.id)).toMatchObject({ action: "archive", orders: 1, paidOrders: 1, files: 1, previews: 1 });
    expect(plan.ok && plan.items.find((i) => i.id === unsold.id)).toMatchObject({ action: "delete" });

    const res = await bulkDeleteProducts(p.db, { mode: "ids", ids: [unsold.id, sold.id] }, actor);
    expect(res.ok && res.results.map((r) => [r.id, r.outcome])).toEqual(expect.arrayContaining([[unsold.id, "deleted"], [sold.id, "archived"]]));
    expect(await row(unsold.id)).toBeUndefined();
    expect(await row(sold.id)).toMatchObject({ status: "ARCHIVED" });
    // The paid file, order and payment records remain; the buyer can still download.
    expect(await p.db.$count(digitalFiles, eq(digitalFiles.id, file.id))).toBe(1);
    expect(res.ok && res.privateKeys).not.toContain(file.r2Key);
    expect(await p.db.$count(orders, eq(orders.id, purchase.orderId))).toBe(1);
    expect((await authorizeDownload(p.db, purchase.buyer.id, purchase.item.id, file.id)).ok).toBe(true);
    // The archived product's approved preview is no longer served publicly.
    const [preview] = await p.db.select().from(previewModels).where(eq(previewModels.productId, sold.id));
    expect(await findServablePreview(p.db, preview.id)).toBeNull();
    expect(PUBLIC_MEDIA_KEY.test(key)).toBe(false);
  });
});

describe("digital files management", () => {
  it("lists paid files with entitlement counts and never exposes storage keys", async () => {
    const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL", basePrice: 5_000 });
    const name = `listed-${crypto.randomUUID().slice(0, 6)}.stl`;
    await p.db.insert(digitalFiles).values({ productId: product.id, r2Key: `digital/2026/10/${crypto.randomUUID()}.stl`, filename: name, format: "STL", sizeBytes: 84 });
    await buy(product.id);
    const list = await listDigitalFilesAdmin(p.db, { q: name });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ filename: name, entitled: 1, paidBuyers: 0 });
    expect(JSON.stringify(list.rows)).not.toMatch(/digital\/2026/);
  });

  it("deactivating files with entitled buyers needs an acknowledgement; status never makes a file public", async () => {
    const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL", basePrice: 5_000 });
    const [file] = await p.db.insert(digitalFiles).values({ productId: product.id, r2Key: `digital/2026/10/${crypto.randomUUID()}.stl`, filename: "a.stl", format: "STL", sizeBytes: 84 }).returning();
    const purchase = await buy(product.id);
    await confirmDue(p.db, purchase.orderId);
    expect(await bulkSetDigitalFilesActive(p.db, [file.id], false, false, actor)).toEqual({ ok: false, error: "buyers_affected", buyers: 1 });
    expect(await bulkSetDigitalFilesActive(p.db, [file.id], false, true, actor)).toMatchObject({ ok: true, changed: 1 });
    expect(await authorizeDownload(p.db, purchase.buyer.id, purchase.item.id, file.id)).toEqual({ ok: false, error: "not_found" });
    expect(await bulkSetDigitalFilesActive(p.db, [file.id], true, false, actor)).toMatchObject({ ok: true, changed: 1 });
    expect((await authorizeDownload(p.db, purchase.buyer.id, purchase.item.id, file.id)).ok).toBe(true);
    // An anonymous or unrelated user still cannot download, whatever the status.
    const stranger = await makeUser(p.db);
    expect(await authorizeDownload(p.db, stranger.id, purchase.item.id, file.id)).toEqual({ ok: false, error: "not_found" });
    expect(PUBLIC_MEDIA_KEY.test(file.r2Key)).toBe(false);
  });

  it("refuses to delete files of ordered products; deletes unreferenced ones", async () => {
    const sold = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL" });
    const unsold = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL" });
    const [kept] = await p.db.insert(digitalFiles).values({ productId: sold.id, r2Key: `digital/2026/10/${crypto.randomUUID()}.stl`, filename: "k.stl", format: "STL", sizeBytes: 84 }).returning();
    const [gone] = await p.db.insert(digitalFiles).values({ productId: unsold.id, r2Key: `digital/2026/10/${crypto.randomUUID()}.stl`, filename: "g.stl", format: "STL", sizeBytes: 84 }).returning();
    await buy(sold.id);
    const res = await bulkDeleteDigitalFiles(p.db, [kept.id, gone.id], actor);
    expect(res).toMatchObject({ ok: true, deleted: 1, kept: [{ id: kept.id, orders: 1 }], keys: [gone.r2Key] });
    expect(await p.db.$count(digitalFiles, inArray(digitalFiles.id, [kept.id]))).toBe(1);
    expect(await p.db.$count(digitalFiles, inArray(digitalFiles.id, [gone.id]))).toBe(0);
  });

  it("renaming changes only the download name and keeps the extension", async () => {
    const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL" });
    const [file] = await p.db.insert(digitalFiles).values({ productId: product.id, r2Key: `digital/2026/10/${crypto.randomUUID()}.stl`, filename: "old.stl", format: "STL", sizeBytes: 84 }).returning();
    expect(await renameDigitalFile(p.db, file.id, "new.zip", actor)).toEqual({ ok: false, error: "extension_mismatch" });
    expect(await renameDigitalFile(p.db, file.id, "../evil.stl", actor)).toEqual({ ok: false, error: "invalid_input" });
    expect(await renameDigitalFile(p.db, file.id, "Gear v2.stl", actor)).toEqual({ ok: true });
    const [after] = await p.db.select().from(digitalFiles).where(eq(digitalFiles.id, file.id));
    expect(after).toMatchObject({ filename: "Gear v2.stl", r2Key: file.r2Key });
  });
});
