import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { discounts, orders, orderStatusHistory, products, uploads } from "@/server/db/schema";
import { addToCart } from "@/server/services/cart";
import { changeOrderStatus, changePaymentStatus } from "@/server/services/admin-orders";
import { placeOrder, getOrderByAccessToken } from "@/server/services/orders";
import { acceptQuote, declineQuote, getCustomRequestForCustomer, reviewCustomRequest, submitCustomRequest } from "@/server/services/custom-print";
import { authorizeDownload, listEntitlements, MAX_DOWNLOADS_PER_ITEM } from "@/server/services/downloads";
import { digitalFiles, orderItems } from "@/server/db/schema";
import { startPlatform, type TestPlatform } from "../support/platform";
import { checkoutInput, makeDiscount, makeProduct, makeUser, makeZone } from "../support/fixtures";

let p: TestPlatform;
const SECRET = "test-app-secret-at-least-32-characters-long";
const actor = { adminId: null, label: "tester" };
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());
const visitor = () => ({ visitorHash: crypto.randomUUID().replace(/-/g, "") });

async function orderFor(product: typeof products.$inferSelect, qty = 1, extra: Record<string, unknown> = {}) {
  const zone = await makeZone(p.db);
  const owner = visitor();
  await addToCart(p.db, owner, { productId: product.id, quantity: qty, options: {} });
  const r = await placeOrder(p.db, checkoutInput(zone.id, extra), { owner, userId: null, appSecret: SECRET });
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("order status lifecycle", () => {
  it("walks the production pipeline and marks COD paid on delivery", async () => {
    const r = await orderFor(await makeProduct(p.db));
    const steps = ["CONFIRMED", "IN_PRODUCTION", "QUALITY_CHECK", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
    let from = "PENDING" as (typeof steps)[number] | "PENDING";
    for (const to of steps) {
      expect(await changeOrderStatus(p.db, r.orderId, { to, expectedFrom: from, publicNote: to === "OUT_FOR_DELIVERY" ? "Courier: Ahmed" : undefined }, actor)).toEqual({ ok: true });
      from = to;
    }
    const [o] = await p.db.select().from(orders).where(eq(orders.id, r.orderId));
    expect(o).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID" });
    expect(o.confirmedAt).not.toBeNull();
    expect(await p.db.$count(orderStatusHistory, eq(orderStatusHistory.orderId, r.orderId))).toBe(7);
    const view = await getOrderByAccessToken(p.db, r.orderNumber, r.accessToken);
    expect(view?.history.find((h) => h.toStatus === "OUT_FOR_DELIVERY")?.publicNote).toBe("Courier: Ahmed");
  });

  it("rejects invalid transitions and stale concurrent updates", async () => {
    const r = await orderFor(await makeProduct(p.db));
    expect(await changeOrderStatus(p.db, r.orderId, { to: "DELIVERED", expectedFrom: "PENDING" }, actor)).toEqual({ ok: false, error: "invalid_transition" });
    expect(await changeOrderStatus(p.db, r.orderId, { to: "CONFIRMED", expectedFrom: "PENDING" }, actor)).toEqual({ ok: true });
    // Second admin still looking at PENDING:
    expect(await changeOrderStatus(p.db, r.orderId, { to: "CANCELLED", expectedFrom: "PENDING" }, actor)).toEqual({ ok: false, error: "conflict" });
  });

  it("restores stock and releases the discount when an order is cancelled", async () => {
    const product = await makeProduct(p.db, { availability: "IN_STOCK", stockQuantity: 5, basePrice: 10_000 });
    const discount = await makeDiscount(p.db, { maxUses: 10 });
    const r = await orderFor(product, 3, { discountCode: discount.code });
    expect((await p.db.select().from(products).where(eq(products.id, product.id)))[0].stockQuantity).toBe(2);
    expect((await p.db.select().from(discounts).where(eq(discounts.id, discount.id)))[0].usedCount).toBe(1);
    expect(await changeOrderStatus(p.db, r.orderId, { to: "CANCELLED", expectedFrom: "PENDING" }, actor)).toEqual({ ok: true });
    expect((await p.db.select().from(products).where(eq(products.id, product.id)))[0].stockQuantity).toBe(5);
    expect((await p.db.select().from(discounts).where(eq(discounts.id, discount.id)))[0].usedCount).toBe(0);
    expect(await changeOrderStatus(p.db, r.orderId, { to: "CONFIRMED", expectedFrom: "CANCELLED" }, actor)).toEqual({ ok: false, error: "invalid_transition" });
  });
});

describe("digital downloads", () => {
  it("unlocks only for the paying owner, and respects the download cap", async () => {
    const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL", basePrice: 5_000 });
    const [file] = await p.db.insert(digitalFiles).values({ productId: product.id, r2Key: "digital/2026/01/x.stl", filename: "x.stl", format: "STL", sizeBytes: 684 }).returning();
    const buyer = await makeUser(p.db);
    const stranger = await makeUser(p.db);
    await addToCart(p.db, { userId: buyer.id }, { productId: product.id, quantity: 1, options: {} });
    const r = await placeOrder(p.db, { idempotencyKey: crypto.randomUUID(), fullName: "Buyer", phone: "07501234567", locale: "en" }, { owner: { userId: buyer.id }, userId: buyer.id, appSecret: SECRET });
    if (!r.ok) throw new Error(r.error);
    const [item] = await p.db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId));

    expect(await authorizeDownload(p.db, buyer.id, item.id, file.id)).toEqual({ ok: false, error: "unpaid" });
    expect((await listEntitlements(p.db, buyer.id))[0].unlocked).toBe(false);
    await changePaymentStatus(p.db, r.orderId, "PAID", actor);
    expect(await authorizeDownload(p.db, stranger.id, item.id, file.id)).toEqual({ ok: false, error: "not_found" });
    const ok = await authorizeDownload(p.db, buyer.id, item.id, file.id);
    expect(ok.ok && ok.file.r2Key).toBe("digital/2026/01/x.stl");

    // A file id from another product is never served through this purchase.
    const other = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL" });
    const [otherFile] = await p.db.insert(digitalFiles).values({ productId: other.id, r2Key: "digital/2026/01/y.stl", filename: "y.stl", format: "STL", sizeBytes: 684 }).returning();
    expect(await authorizeDownload(p.db, buyer.id, item.id, otherFile.id)).toEqual({ ok: false, error: "not_found" });

    await p.db.update(orderItems).set({ downloadCount: MAX_DOWNLOADS_PER_ITEM }).where(eq(orderItems.id, item.id));
    expect(await authorizeDownload(p.db, buyer.id, item.id, file.id)).toEqual({ ok: false, error: "limit_reached" });

    await changeOrderStatus(p.db, r.orderId, { to: "CANCELLED", expectedFrom: "PENDING" }, actor);
    await p.db.update(orderItems).set({ downloadCount: 0 }).where(eq(orderItems.id, item.id));
    expect(await authorizeDownload(p.db, buyer.id, item.id, file.id)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("custom print requests", () => {
  async function upload(ownerKey: string) {
    const [u] = await p.db.insert(uploads).values({ ownerKey, purpose: "CUSTOM_PRINT", r2Key: "uploads/2026/01/a.stl", filename: "part.stl", extension: "stl", sizeBytes: 1000 }).returning();
    return u.id;
  }

  it("goes from submission to quote to a real COD order", async () => {
    const ownerKey = "visitor:abc";
    const zone = await makeZone(p.db, { fee: 6_000 });
    const sub = await submitCustomRequest(p.db, { fullName: "Zainab", phone: "07801234567", material: "PETG", color: "BLACK", scalePercent: 120, quantity: 2, notes: "M3 holes", uploadIds: [await upload(ownerKey)], locale: "ar" }, { ownerKey, userId: null, appSecret: SECRET });
    if (!sub.ok) throw new Error(sub.error);

    const reviewer = { adminId: null as unknown as string, label: "ops" };
    expect(await reviewCustomRequest(p.db, sub.id, { status: "QUOTED", quotedPrice: "", productionDays: "" }, reviewer)).toEqual({ ok: false, error: "quote_incomplete" });
    expect(await reviewCustomRequest(p.db, sub.id, { status: "QUOTED", quotedPrice: "45000", productionDays: "4", customerMessage: "PETG, 0.2mm" }, reviewer)).toEqual({ ok: true });

    const view = await getCustomRequestForCustomer(p.db, sub.requestNumber, { token: sub.token });
    expect(view?.quotedPrice).toBe(45_000);
    expect(await getCustomRequestForCustomer(p.db, sub.requestNumber, { token: "0".repeat(40) })).toBeNull();

    const accepted = await acceptQuote(p.db, sub.id, { zoneId: zone.id, city: "Basra", district: "Ashar", addressLine: "Street 1" }, { appSecret: SECRET });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const [order] = await p.db.select().from(orders).where(eq(orders.orderNumber, accepted.orderNumber));
    // Flat 5,000 IQD delivery (the legacy 6,000 zone fee is ignored); 45,000 is below the deposit threshold.
    expect(order).toMatchObject({ subtotal: 45_000, deliveryFee: 5_000, total: 50_000, paymentMethod: "COD", customRequestId: sub.id, status: "PENDING", depositRequired: false });
    // Idempotent: accepting again returns the same order; the quote is now locked.
    const again = await acceptQuote(p.db, sub.id, { zoneId: zone.id, city: "Basra", district: "Ashar", addressLine: "Street 1" }, { appSecret: SECRET });
    expect(again.ok && again.orderNumber).toBe(accepted.orderNumber);
    expect(await reviewCustomRequest(p.db, sub.id, { status: "ACCEPTED", quotedPrice: "1", productionDays: "4" }, reviewer)).toMatchObject({ ok: false });
  });

  it("rejects uploads owned by someone else and unknown materials", async () => {
    const theirs = await upload("visitor:victim");
    const res = await submitCustomRequest(p.db, { fullName: "Mallory", phone: "07801234567", material: "PLA", color: "BLACK", scalePercent: 100, quantity: 1, uploadIds: [theirs], locale: "en" }, { ownerKey: "visitor:attacker", userId: null, appSecret: SECRET });
    expect(res).toMatchObject({ ok: false, error: "invalid_upload" });
    const mine = await upload("visitor:me");
    expect(await submitCustomRequest(p.db, { fullName: "Me", phone: "07801234567", material: "UNOBTAINIUM", color: "BLACK", scalePercent: 100, quantity: 1, uploadIds: [mine], locale: "en" }, { ownerKey: "visitor:me", userId: null, appSecret: SECRET })).toMatchObject({ ok: false });
  });

  it("lets the customer decline a quote", async () => {
    const ownerKey = "visitor:dec";
    const sub = await submitCustomRequest(p.db, { fullName: "Omar", phone: "07701112233", material: "PLA", color: "WHITE", scalePercent: 100, quantity: 1, uploadIds: [await upload(ownerKey)], locale: "ar" }, { ownerKey, userId: null, appSecret: SECRET });
    if (!sub.ok) throw new Error();
    expect(await declineQuote(p.db, sub.id)).toEqual({ ok: false, error: "not_quoted" });
    await reviewCustomRequest(p.db, sub.id, { status: "QUOTED", quotedPrice: "10000", productionDays: "2" }, { adminId: null as unknown as string, label: "ops" });
    expect(await declineQuote(p.db, sub.id)).toEqual({ ok: true });
  });
});
