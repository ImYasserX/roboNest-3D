import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { auditLogs, digitalFiles, orderItems, orders, paymentVerifications } from "@/server/db/schema";
import { addToCart } from "@/server/services/cart";
import { changeOrderStatus } from "@/server/services/admin-orders";
import { authorizeDownload, listEntitlements } from "@/server/services/downloads";
import { placeOrder } from "@/server/services/orders";
import { confirmPayment, disputePayment, listPaymentQueue, recordRefund } from "@/server/services/payment-verification";
import { paymentDue, paymentWhatsappText } from "@/lib/payment-due";
import { businessWhatsappUrl } from "@/lib/business";
import { hasPermission, SUPER_ADMIN_MAY_VERIFY_PAYMENTS } from "@/lib/permissions";
import { POST as fibCallback } from "@/app/api/payments/fib/callback/route";
import { startPlatform, type TestPlatform } from "../support/platform";
import { dbError } from "../support/fakes";
import { checkoutInput, makeProduct, makeUser, makeZone } from "../support/fixtures";
import { ownerActor } from "../support/payments";

let p: TestPlatform;
const SECRET = "test-app-secret-at-least-32-characters-long";
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

const load = async (id: string) => (await p.db.select().from(orders).where(eq(orders.id, id)))[0];
const confirm = (orderId: string, kind: "DEPOSIT" | "FULL", receivedAmount: number, extra: Record<string, unknown> = {}) =>
  confirmPayment(p.db, orderId, { kind, receivedAmount, channel: "WHATSAPP_TRANSFER", checked: true, ...extra }, ownerActor);

/** A digital order owned by a customer account (digital needs an account). */
async function digitalOrder(price = 20_000) {
  const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL", basePrice: price });
  const [file] = await p.db.insert(digitalFiles).values({ productId: product.id, r2Key: `digital/2026/10/${crypto.randomUUID()}.stl`, filename: "m.stl", format: "STL", sizeBytes: 84 }).returning();
  const buyer = await makeUser(p.db);
  await addToCart(p.db, { userId: buyer.id }, { productId: product.id, quantity: 1, options: {} });
  const r = await placeOrder(p.db, { idempotencyKey: crypto.randomUUID(), fullName: "Buyer", phone: "07501234567", locale: "en" }, { owner: { userId: buyer.id }, userId: buyer.id, appSecret: SECRET });
  if (!r.ok) throw new Error(r.error);
  const [item] = await p.db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId));
  return { ...r, buyer, file, item };
}

async function physicalOrder(price: number) {
  const product = await makeProduct(p.db, { basePrice: price });
  const zone = await makeZone(p.db);
  const owner = { visitorHash: crypto.randomUUID().replace(/-/g, "") };
  await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
  const r = await placeOrder(p.db, checkoutInput(zone.id), { owner, userId: null, appSecret: SECRET });
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("checkout creates a pending manual payment", () => {
  it("digital orders wait for a full WhatsApp payment; nothing starts as paid", async () => {
    const o = await digitalOrder(20_000);
    const order = await load(o.orderId);
    expect(order).toMatchObject({ status: "PENDING", paymentStatus: "PENDING", depositRequired: false });
    expect(paymentDue(order)).toEqual({ kind: "FULL", amount: 20_000, channel: "WHATSAPP" });
    // The database refuses a new order row that claims to be paid.
    await expect(p.db.insert(orders).values({ ...order, id: crypto.randomUUID(), orderNumber: "RN-X-1", idempotencyKey: crypto.randomUUID(), paymentStatus: "PAID" })).rejects.toThrow();
  });

  it("the WhatsApp message carries only the reference and amount, for the verified business number", () => {
    const due = { kind: "DEPOSIT" as const, amount: 22_200, channel: "WHATSAPP" as const };
    const url = businessWhatsappUrl(paymentWhatsappText("en", "RN-261012-ABC123", due));
    expect(url).toBe("https://wa.me/9647518911112?text=" + encodeURIComponent("Hello RoboNest.3D, I would like to confirm the deposit for order RN-261012-ABC123. Amount: 22,200 IQD."));
    expect(businessWhatsappUrl()).toBe("https://wa.me/9647518911112");
    expect(paymentWhatsappText("ar", "RN-1", { ...due, kind: "FULL" })).toContain("RN-1");
  });
});

describe("only an authorized confirmation changes a payment", () => {
  it("customer-side paths cannot approve: no reference form, no screenshot route, the provider callback is retired", async () => {
    const o = await digitalOrder();
    // The retired FIB callback answers 410 and touches nothing, whatever it is sent.
    void new Request("http://localhost/api/payments/fib/callback", { method: "POST", body: JSON.stringify({ id: "x", status: "PAID" }) });
    const res = await fibCallback();
    expect(res.status).toBe(410);
    expect(await load(o.orderId)).toMatchObject({ paymentStatus: "PENDING" });
    // A raw update without a verification record is refused by the database.
    expect(await dbError(p.db.update(orders).set({ paymentStatus: "PAID" }).where(eq(orders.id, o.orderId)))).toMatch(/payment_not_verified/);
    // Nothing in the codebase lets a customer action change payment state.
    const order = readFileSync("src/components/order/order-view.tsx", "utf8");
    expect(order).not.toMatch(/use server|Action\(/);
    for (const f of ["src/server/actions/checkout.ts", "src/server/actions/custom-print.ts", "src/app/api/uploads/route.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/paymentStatus|confirmPayment|depositStatus/);
    }
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(middleware).not.toContain("isProviderCallback");
  });

  it("payment verification is Owner-only and enforced by the server actions", () => {
    expect(SUPER_ADMIN_MAY_VERIFY_PAYMENTS).toBe(false);
    expect(hasPermission("OWNER", "payments.verify")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "payments.verify")).toBe(false);
    expect(hasPermission("OPERATIONS", "payments.verify")).toBe(false);
    // orders.update (Operations) no longer reaches any payment change.
    const actions = readFileSync("src/server/actions/admin/orders.ts", "utf8");
    for (const fn of ["confirmPayment", "disputePayment", "recordRefund"]) expect(actions).toMatch(new RegExp(`withAdmin\\("payments\\.verify", \\(\\{ db, actor \\}\\) => ${fn}\\(`));
    expect(actions).not.toMatch(/changePaymentStatus|paymentStatus:/);
    // Delivering an order never marks it paid.
    expect(readFileSync("src/server/services/admin-orders.ts", "utf8")).not.toMatch(/paymentStatus = "PAID"|patch\.paymentStatus/);
  });

  it("amounts come from the order: wrong amounts, kinds or missing confirmation are refused", async () => {
    const o = await digitalOrder(20_000);
    expect(await confirm(o.orderId, "FULL", 19_999)).toEqual({ ok: false, error: "amount_mismatch" });
    expect(await confirm(o.orderId, "DEPOSIT", 20_000)).toEqual({ ok: false, error: "wrong_kind" });
    expect(await confirmPayment(p.db, o.orderId, { kind: "FULL", receivedAmount: 20_000, channel: "WHATSAPP_TRANSFER" }, ownerActor)).toEqual({ ok: false, error: "invalid_input" });
    expect(await confirm(o.orderId, "FULL", 20_000, { currency: "USD", amount: 1, status: "PAID" })).toEqual({ ok: true }); // extra fields are ignored
    const v = await p.db.select().from(paymentVerifications).where(eq(paymentVerifications.orderId, o.orderId));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: "FULL", action: "CONFIRMED", amount: 20_000, currency: "IQD", adminLabel: "Test owner" });
    // A confirmation row for a wrong amount is refused by the database too.
    const other = await digitalOrder(20_000);
    expect(await dbError(p.db.insert(paymentVerifications).values({ orderId: other.orderId, kind: "FULL", action: "CONFIRMED", amount: 1, adminLabel: "x" }))).toMatch(/payment_amount_mismatch/);
  });

  it("duplicate and concurrent confirmations are safe: exactly one succeeds", async () => {
    const o = await digitalOrder(30_000);
    const results = await Promise.all([1, 2, 3].map(() => confirm(o.orderId, "FULL", 30_000)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && ["already_confirmed", "not_due", "conflict"].includes(r.error))).toBe(true);
    expect(await p.db.$count(paymentVerifications, eq(paymentVerifications.orderId, o.orderId))).toBe(1);
    expect(await confirm(o.orderId, "FULL", 30_000)).toEqual({ ok: false, error: "not_due" });
  });

  it("conflicting transitions are refused: cancelled orders, disputes, refunds of unpaid orders", async () => {
    const o = await digitalOrder();
    await changeOrderStatus(p.db, o.orderId, { to: "CANCELLED", expectedFrom: "PENDING" }, ownerActor);
    expect(await confirm(o.orderId, "FULL", 20_000)).toEqual({ ok: false, error: "not_due" });
    // Even a direct verification row is refused for a closed order.
    expect(await dbError(p.db.insert(paymentVerifications).values({ orderId: o.orderId, kind: "FULL", action: "CONFIRMED", amount: 20_000, adminLabel: "x" }))).toMatch(/payment_not_due/);

    const d = await digitalOrder();
    expect(await recordRefund(p.db, d.orderId, { kind: "FULL", reason: "test", confirmText: "REFUNDED" }, ownerActor)).toEqual({ ok: false, error: "not_refundable" });
    expect(await dbError(p.db.update(orders).set({ paymentStatus: "REFUNDED" }).where(eq(orders.id, d.orderId)))).toMatch(/refund_requires_paid/);
    // The ledger is append-only.
    await confirm(d.orderId, "FULL", 20_000);
    expect(await dbError(p.db.update(paymentVerifications).set({ amount: 1 }).where(eq(paymentVerifications.orderId, d.orderId)))).toMatch(/immutable/);
  });
});

describe("downloads and deposits", () => {
  it("full payment unlocks only that buyer's downloads; pending, disputed and refunded keep them locked", async () => {
    const o = await digitalOrder(20_000);
    expect(await authorizeDownload(p.db, o.buyer.id, o.item.id, o.file.id)).toEqual({ ok: false, error: "unpaid" });
    expect(await disputePayment(p.db, o.orderId, { kind: "FULL", reason: "No transfer found" }, ownerActor)).toEqual({ ok: true });
    expect(await load(o.orderId)).toMatchObject({ paymentStatus: "DISPUTED" });
    expect(await authorizeDownload(p.db, o.buyer.id, o.item.id, o.file.id)).toEqual({ ok: false, error: "unpaid" });
    expect((await listEntitlements(p.db, o.buyer.id))[0].unlocked).toBe(false);
    // Resolved after checking again: confirm from DISPUTED.
    expect(await confirm(o.orderId, "FULL", 20_000)).toEqual({ ok: true });
    const ok = await authorizeDownload(p.db, o.buyer.id, o.item.id, o.file.id);
    expect(ok.ok).toBe(true);
    const stranger = await makeUser(p.db);
    expect(await authorizeDownload(p.db, stranger.id, o.item.id, o.file.id)).toEqual({ ok: false, error: "not_found" });
    // A recorded refund locks the files again.
    expect(await recordRefund(p.db, o.orderId, { kind: "FULL", reason: "Returned by FIB transfer", confirmText: "nope" }, ownerActor)).toEqual({ ok: false, error: "invalid_input" });
    expect(await recordRefund(p.db, o.orderId, { kind: "FULL", reason: "Returned by FIB transfer", confirmText: "REFUNDED" }, ownerActor)).toEqual({ ok: true });
    expect(await authorizeDownload(p.db, o.buyer.id, o.item.id, o.file.id)).toEqual({ ok: false, error: "unpaid" });
  });

  it("a verified deposit never marks the order paid nor unlocks files; the balance is due afterwards", async () => {
    const o = await digitalOrder(60_000); // digital, 60,000 → 18,000 deposit
    const order = await load(o.orderId);
    expect(order).toMatchObject({ status: "AWAITING_DEPOSIT", depositAmount: 18_000 });
    expect(await confirm(o.orderId, "FULL", 60_000)).toEqual({ ok: false, error: "wrong_kind" }); // deposit first
    expect(await confirm(o.orderId, "DEPOSIT", 18_000)).toEqual({ ok: true });
    const after = await load(o.orderId);
    expect(after).toMatchObject({ status: "DEPOSIT_VERIFIED", depositStatus: "VERIFIED", paymentStatus: "PENDING" });
    expect(await authorizeDownload(p.db, o.buyer.id, o.item.id, o.file.id)).toEqual({ ok: false, error: "unpaid" });
    expect(paymentDue(after)).toEqual({ kind: "FULL", amount: 42_000, channel: "WHATSAPP" });
    expect(await confirm(o.orderId, "FULL", 60_000)).toEqual({ ok: false, error: "amount_mismatch" });
    expect(await confirm(o.orderId, "FULL", 42_000)).toEqual({ ok: true });
    expect((await authorizeDownload(p.db, o.buyer.id, o.item.id, o.file.id)).ok).toBe(true);
  });

  it("the 50,000 threshold and 30% rule decide the deposit; a rejected deposit stays awaited", async () => {
    const exact = await physicalOrder(50_000);
    expect(paymentDue(await load(exact.orderId))).toEqual({ kind: "FULL", amount: 55_000, channel: "ON_DELIVERY" });
    const high = await physicalOrder(74_000);
    expect(paymentDue(await load(high.orderId))).toEqual({ kind: "DEPOSIT", amount: 22_200, channel: "WHATSAPP" });
    expect(await disputePayment(p.db, high.orderId, { kind: "DEPOSIT", reason: "x" }, ownerActor)).toEqual({ ok: false, error: "invalid_input" }); // reason required
    expect(await disputePayment(p.db, high.orderId, { kind: "DEPOSIT", reason: "Not in the account", publicNote: "Please send the transfer receipt on WhatsApp." }, ownerActor)).toEqual({ ok: true });
    expect(await load(high.orderId)).toMatchObject({ status: "AWAITING_DEPOSIT", depositStatus: "AWAITING" });
    expect(await confirm(high.orderId, "DEPOSIT", 22_200)).toEqual({ ok: true });
    // Fulfilment can now start, but the order is not paid.
    expect(await changeOrderStatus(p.db, high.orderId, { to: "CONFIRMED", expectedFrom: "DEPOSIT_VERIFIED" }, ownerActor)).toEqual({ ok: true });
    expect(paymentDue(await load(high.orderId))).toEqual({ kind: "FULL", amount: 56_800, channel: "ON_DELIVERY" });
  });

  it("audit logs record confirmations and rejections; the queue lists what is waiting", async () => {
    const o = await physicalOrder(90_000);
    const queue = await listPaymentQueue(p.db, { view: "awaiting", kind: "DEPOSIT" });
    expect(queue.orders.some((r) => r.id === o.orderId)).toBe(true);
    // Customer reference only: never the full phone number.
    expect(JSON.stringify(queue.orders)).not.toMatch(/7701234567/);
    await disputePayment(p.db, o.orderId, { kind: "DEPOSIT", reason: "Waiting for the receipt" }, ownerActor);
    await confirm(o.orderId, "DEPOSIT", 27_000);
    const actions = (await p.db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.targetId, o.orderId))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["payment.deposit.rejected", "payment.deposit.confirmed"]));
    const history = await listPaymentQueue(p.db, { view: "history", q: o.orderNumber });
    expect(history.history.map((h) => h.action).sort()).toEqual(["CONFIRMED", "REJECTED"]);
  });
});
