import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { discounts, orderItems, orders, orderStatusHistory, products } from "@/server/db/schema";
import { addToCart, getCartView, mergeVisitorCart, removeCartItem, updateCartItemQuantity } from "@/server/services/cart";
import { findOrderByNumberAndPhone, getOrderByAccessToken, getOrderForUser, placeOrder } from "@/server/services/orders";
import { startPlatform, type TestPlatform } from "../support/platform";
import { checkoutInput, makeArea, makeCustomizableProduct, makeDiscount, makeProduct, makeUser, makeZone } from "../support/fixtures";

let p: TestPlatform;
const SECRET = "test-app-secret-at-least-32-characters-long";
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

const visitor = () => ({ visitorHash: crypto.randomUUID().replace(/-/g, "") });

describe("cart", () => {
  it("prices lines server-side and merges identical selections", async () => {
    const { product, gold, color } = await makeCustomizableProduct(p.db);
    const owner = visitor();
    expect((await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: { [color.id]: gold.id } })).ok).toBe(true);
    expect((await addToCart(p.db, owner, { productId: product.id, quantity: 2, options: { [color.id]: gold.id } })).ok).toBe(true);
    const cart = await getCartView(p.db, owner);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(3);
    expect(cart.lines[0].unitPrice).toBe(23_000);
    expect(cart.subtotal).toBe(69_000);
  });

  it("re-prices when the admin changes the product price", async () => {
    const product = await makeProduct(p.db, { basePrice: 10_000 });
    const owner = visitor();
    await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
    await p.db.update(products).set({ basePrice: 12_500 }).where(eq(products.id, product.id));
    expect((await getCartView(p.db, owner)).subtotal).toBe(12_500);
  });

  it("rejects invalid options and draft products", async () => {
    const { product, color } = await makeCustomizableProduct(p.db);
    const owner = visitor();
    expect((await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} })).ok).toBe(false);
    expect((await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: { [color.id]: "not-a-value" } })).ok).toBe(false);
    const draft = await makeProduct(p.db, { status: "DRAFT" });
    expect((await addToCart(p.db, owner, { productId: draft.id, quantity: 1, options: {} })).ok).toBe(false);
  });

  it("does not let one visitor modify another visitor's cart line (IDOR)", async () => {
    const product = await makeProduct(p.db);
    const alice = visitor();
    const mallory = visitor();
    const added = await addToCart(p.db, alice, { productId: product.id, quantity: 1, options: {} });
    if (!added.ok) throw new Error("setup");
    await addToCart(p.db, mallory, { productId: product.id, quantity: 1, options: {} });
    expect(await updateCartItemQuantity(p.db, mallory, added.itemId, 50)).toEqual({ ok: false, error: "not_found" });
    expect(await removeCartItem(p.db, mallory, added.itemId)).toEqual({ ok: false, error: "not_found" });
    expect((await getCartView(p.db, alice)).lines[0].quantity).toBe(1);
  });

  it("merges a visitor cart into the user cart on login", async () => {
    const product = await makeProduct(p.db);
    const user = await makeUser(p.db);
    const owner = visitor();
    await addToCart(p.db, owner, { productId: product.id, quantity: 2, options: {} });
    await addToCart(p.db, { userId: user.id }, { productId: product.id, quantity: 1, options: {} });
    await mergeVisitorCart(p.db, owner.visitorHash, user.id);
    const cart = await getCartView(p.db, { userId: user.id });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(3);
    expect((await getCartView(p.db, owner)).lines).toHaveLength(0);
  });
});

describe("checkout", () => {
  it("creates a COD order with server-calculated totals, snapshots and history", async () => {
    const { product, color, gold, engraving } = await makeCustomizableProduct(p.db, { costPrice: 8_000 });
    const zone = await makeZone(p.db, { fee: 5_000 });
    const discount = await makeDiscount(p.db, { type: "PERCENT", value: 10 });
    const owner = visitor();
    await addToCart(p.db, owner, { productId: product.id, quantity: 2, options: { [color.id]: gold.id, [engraving.id]: "RoboNest" } });

    const result = await placeOrder(
      p.db,
      // Extra fields a tampered client might send are ignored.
      { ...checkoutInput(zone.id, { discountCode: discount.code.toLowerCase() }), total: 1, deliveryFee: 0, price: 1 },
      { owner, userId: null, appSecret: SECRET },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [order] = await p.db.select().from(orders).where(eq(orders.id, result.orderId));
    // (20000 + 3000 + 2000) * 2 = 50000; 10% = 5000; + 5000 delivery
    expect(order).toMatchObject({ subtotal: 50_000, discountTotal: 5_000, deliveryFee: 5_000, total: 50_000, paymentMethod: "COD", paymentStatus: "PENDING", status: "PENDING", customerPhone: "+9647701234567" });
    const items = await p.db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(items[0]).toMatchObject({ productNameEn: "Robot Arm Kit", unitPrice: 25_000, unitCost: 8_000, quantity: 2, lineTotal: 50_000 });
    expect(items[0].options.map((o) => o.value.en)).toEqual(["Gold", "RoboNest"]);
    expect(await p.db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, order.id))).toHaveLength(1);
    expect((await getCartView(p.db, owner)).lines).toHaveLength(0);
    expect((await p.db.select().from(discounts).where(eq(discounts.id, discount.id)))[0].usedCount).toBe(1);

    // Snapshot survives later product edits.
    await p.db.update(products).set({ nameEn: "Renamed", basePrice: 1 }).where(eq(products.id, product.id));
    const view = await getOrderByAccessToken(p.db, result.orderNumber, result.accessToken);
    expect(view?.items[0].productNameEn).toBe("Robot Arm Kit");
    expect(view?.total).toBe(50_000);
  });

  it("uses the delivery area fee override and rejects unknown zones", async () => {
    const product = await makeProduct(p.db, { basePrice: 10_000 });
    const zone = await makeZone(p.db, { fee: 6_000 });
    const area = await makeArea(p.db, zone.id, 3_000);
    const owner = visitor();
    await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
    const bad = await placeOrder(p.db, checkoutInput(crypto.randomUUID()), { owner, userId: null, appSecret: SECRET });
    expect(bad).toEqual({ ok: false, error: "zone_unavailable" });
    const inactive = await makeZone(p.db, { isActive: false });
    expect(await placeOrder(p.db, checkoutInput(inactive.id), { owner, userId: null, appSecret: SECRET })).toEqual({ ok: false, error: "zone_unavailable" });
    const ok = await placeOrder(p.db, checkoutInput(zone.id, { areaId: area.id }), { owner, userId: null, appSecret: SECRET });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((await p.db.select().from(orders).where(eq(orders.id, ok.orderId)))[0].deliveryFee).toBe(3_000);
  });

  it("is idempotent: repeated submits return the same order", async () => {
    const product = await makeProduct(p.db);
    const zone = await makeZone(p.db);
    const owner = visitor();
    await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
    const input = checkoutInput(zone.id);
    const [a, b] = await Promise.all([
      placeOrder(p.db, input, { owner, userId: null, appSecret: SECRET }),
      placeOrder(p.db, input, { owner, userId: null, appSecret: SECRET }),
    ]);
    const c = await placeOrder(p.db, input, { owner, userId: null, appSecret: SECRET });
    const ids = [a, b, c].map((r) => (r.ok ? r.orderId : r.error));
    expect(new Set(ids).size).toBe(1);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (c.ok) expect(c.duplicate).toBe(true);
    expect(await p.db.$count(orders, eq(orders.customerName, "Ali Hassan"))).toBeGreaterThan(0);
  });

  it("prevents overselling the last in-stock unit across concurrent checkouts", async () => {
    const product = await makeProduct(p.db, { availability: "IN_STOCK", stockQuantity: 1 });
    const zone = await makeZone(p.db);
    const a = visitor();
    const b = visitor();
    await addToCart(p.db, a, { productId: product.id, quantity: 1, options: {} });
    await addToCart(p.db, b, { productId: product.id, quantity: 1, options: {} });
    const results = await Promise.all([
      placeOrder(p.db, checkoutInput(zone.id), { owner: a, userId: null, appSecret: SECRET }),
      placeOrder(p.db, checkoutInput(zone.id), { owner: b, userId: null, appSecret: SECRET }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const [after] = await p.db.select().from(products).where(eq(products.id, product.id));
    expect(after.stockQuantity).toBe(0);
  });

  it("enforces discount usage limits", async () => {
    const product = await makeProduct(p.db);
    const zone = await makeZone(p.db);
    const discount = await makeDiscount(p.db, { type: "FIXED", value: 1_000, maxUses: 1 });
    const a = visitor();
    const b = visitor();
    await addToCart(p.db, a, { productId: product.id, quantity: 1, options: {} });
    await addToCart(p.db, b, { productId: product.id, quantity: 1, options: {} });
    expect((await placeOrder(p.db, checkoutInput(zone.id, { discountCode: discount.code }), { owner: a, userId: null, appSecret: SECRET })).ok).toBe(true);
    expect(await placeOrder(p.db, checkoutInput(zone.id, { discountCode: discount.code }), { owner: b, userId: null, appSecret: SECRET })).toEqual({ ok: false, error: "discount_exhausted" });
  });

  it("requires an account for digital products and skips delivery for digital-only orders", async () => {
    const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL", basePrice: 7_000 });
    const owner = visitor();
    await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
    expect(await placeOrder(p.db, { idempotencyKey: crypto.randomUUID(), fullName: "Sara", phone: "07801234567", locale: "ar" }, { owner, userId: null, appSecret: SECRET })).toEqual({ ok: false, error: "login_required_for_digital" });

    const user = await makeUser(p.db);
    await addToCart(p.db, { userId: user.id }, { productId: product.id, quantity: 1, options: {} });
    const ok = await placeOrder(p.db, { idempotencyKey: crypto.randomUUID(), fullName: "Sara", phone: "07801234567", locale: "ar" }, { owner: { userId: user.id }, userId: user.id, appSecret: SECRET });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((await p.db.select().from(orders).where(eq(orders.id, ok.orderId)))[0]).toMatchObject({ deliveryFee: 0, total: 7_000, hasDigital: true, hasPhysical: false });
  });

  it("rejects invalid Iraqi phone numbers and empty carts", async () => {
    const zone = await makeZone(p.db);
    const owner = visitor();
    expect(await placeOrder(p.db, checkoutInput(zone.id), { owner, userId: null, appSecret: SECRET })).toEqual({ ok: false, error: "cart_empty" });
    const product = await makeProduct(p.db);
    await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
    expect(await placeOrder(p.db, checkoutInput(zone.id, { phone: "+1 555 123 4567" }), { owner, userId: null, appSecret: SECRET })).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("order access control", () => {
  it("only lets the owner, the token holder, or the matching phone see an order", async () => {
    const product = await makeProduct(p.db);
    const zone = await makeZone(p.db);
    const owner = await makeUser(p.db);
    const other = await makeUser(p.db);
    await addToCart(p.db, { userId: owner.id }, { productId: product.id, quantity: 1, options: {} });
    const r = await placeOrder(p.db, checkoutInput(zone.id), { owner: { userId: owner.id }, userId: owner.id, appSecret: SECRET });
    if (!r.ok) throw new Error(r.error);

    expect(await getOrderForUser(p.db, r.orderNumber, owner.id)).not.toBeNull();
    expect(await getOrderForUser(p.db, r.orderNumber, other.id)).toBeNull();
    expect(await getOrderByAccessToken(p.db, r.orderNumber, r.accessToken)).not.toBeNull();
    expect(await getOrderByAccessToken(p.db, r.orderNumber, "0".repeat(40))).toBeNull();
    expect(await findOrderByNumberAndPhone(p.db, r.orderNumber, "0770 123 4567")).not.toBeNull();
    expect(await findOrderByNumberAndPhone(p.db, r.orderNumber, "0770 123 4568")).toBeNull();

    const view = await getOrderForUser(p.db, r.orderNumber, owner.id);
    expect(view).not.toHaveProperty("adminNotes");
    expect(view).not.toHaveProperty("idempotencyKey");
    expect(view).not.toHaveProperty("accessTokenHash");
    expect(view?.items[0]).not.toHaveProperty("unitCost");
  });
});

describe("large orders", () => {
  it("checks out a cart with many lines despite D1's 100-parameter limit", async () => {
    const zone = await makeZone(p.db);
    const owner = visitor();
    for (let i = 0; i < 20; i++) {
      const product = await makeProduct(p.db, { basePrice: 1_000 + i });
      expect((await addToCart(p.db, owner, { productId: product.id, quantity: 2, options: {} })).ok).toBe(true);
    }
    const result = await placeOrder(p.db, checkoutInput(zone.id), { owner, userId: null, appSecret: SECRET });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await p.db.$count(orderItems, eq(orderItems.orderId, result.orderId))).toBe(20);
  });
});
