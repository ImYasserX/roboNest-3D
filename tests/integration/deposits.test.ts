import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { notificationEvents, orders, orderStatusHistory } from "@/server/db/schema";
import { addToCart } from "@/server/services/cart";
import { changeOrderStatus } from "@/server/services/admin-orders";
import { rejectDeposit, submitDeposit, verifyDeposit } from "@/server/services/deposits";
import { placeOrder } from "@/server/services/orders";
import { saveSetting } from "@/server/services/settings";
import { dispatchNotification, dispatchPending, renderNotification, retryNotification } from "@/server/services/notifications";
import { startPlatform, type TestPlatform } from "../support/platform";
import { dbError } from "../support/fakes";
import { checkoutInput, makeProduct, makeZone } from "../support/fixtures";
import { fakeFetch, json } from "../support/fakes";

let p: TestPlatform;
const SECRET = "test-app-secret-at-least-32-characters-long";
const admin = { adminId: null as unknown as string, label: "owner" };
const visitor = () => ({ visitorHash: crypto.randomUUID().replace(/-/g, "") });

beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

/** approved: owners approved the manual fallback; fib: the FIB transfer method is enabled. */
async function configureDeposits(approved: boolean, fib = true) {
  await saveSetting(
    p.db,
    "payments",
    {
      manualFallback: approved ? { approved: true, approvedBy: "Yasser Elyas", approvedAt: new Date().toISOString() } : { approved: false, approvedBy: null, approvedAt: null },
      methods: {
        FIB: { enabled: fib, instructions: { en: "FIB 0000", ar: "FIB 0000" } },
        QICARD: { enabled: false, instructions: { en: "", ar: "" } },
        ZAINCASH: { enabled: false, instructions: { en: "", ar: "" } },
      },
    },
    { adminId: null, label: "test" },
  );
}

async function orderWithSubtotal(subtotal: number) {
  const product = await makeProduct(p.db, { basePrice: subtotal });
  const zone = await makeZone(p.db, { fee: 9_000 }); // legacy fee: must be ignored
  const owner = visitor();
  await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
  return placeOrder(p.db, { ...checkoutInput(zone.id), total: 1, depositAmount: 0, status: "CONFIRMED" }, { owner, userId: null, appSecret: SECRET });
}

const load = async (id: string) => (await p.db.select().from(orders).where(eq(orders.id, id)))[0];

describe("high-value orders", () => {
  it("refuses manual transfer reports unless the owners approved the fallback", async () => {
    await configureDeposits(true);
    const r = await orderWithSubtotal(90_000);
    if (!r.ok) throw new Error(r.error);
    await configureDeposits(false, true);
    expect(await submitDeposit(p.db, r.orderId, { method: "FIB", reference: "REF-0001" }, { userId: null, label: "c" })).toEqual({ ok: false, error: "manual_not_approved" });
    // Without approval (and no online provider), new high-value orders are blocked.
    expect(await orderWithSubtotal(90_000)).toEqual({ ok: false, error: "deposit_unconfigured" });
  });

  it("a real online provider alone makes high-value orders payable", async () => {
    await configureDeposits(false, false);
    const product = await makeProduct(p.db, { basePrice: 55_555 });
    const zone = await makeZone(p.db);
    const owner = visitor();
    await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
    const r = await placeOrder(p.db, checkoutInput(zone.id), { owner, userId: null, appSecret: SECRET, onlineDepositAvailable: true });
    if (!r.ok) throw new Error(r.error);
    // floor(55,555 × 30%) = 16,666
    expect(await load(r.orderId)).toMatchObject({ status: "AWAITING_DEPOSIT", depositAmount: 16_666 });
  });

  it("applies discounts before the threshold and the 30% (delivery never counts)", async () => {
    await configureDeposits(true);
    const product = await makeProduct(p.db, { basePrice: 60_000 });
    const zone = await makeZone(p.db);
    const owner = visitor();
    const { makeDiscount } = await import("../support/fixtures");
    const fixed = await makeDiscount(p.db, { type: "FIXED", value: 10_000 });
    await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
    // 60,000 − 10,000 = 50,000: exactly at the threshold → no deposit, even though the total with delivery is 55,000.
    const r = await placeOrder(p.db, checkoutInput(zone.id, { discountCode: fixed.code }), { owner, userId: null, appSecret: SECRET });
    if (!r.ok) throw new Error(r.error);
    expect(await load(r.orderId)).toMatchObject({ subtotal: 60_000, discountTotal: 10_000, total: 55_000, depositRequired: false, depositAmount: 0, status: "PENDING" });
  });

  it("the database rejects orders that break the deposit rule, whatever the code path", async () => {
    const { orderWithBadDeposit } = await import("../support/fixtures");
    expect(await dbError(orderWithBadDeposit(p.db, { subtotal: 60_000, depositRequired: false, depositAmount: 0 }))).toMatch(/orders_deposit_rule/);
    expect(await dbError(orderWithBadDeposit(p.db, { subtotal: 60_000, depositRequired: true, depositAmount: 10_000 }))).toMatch(/orders_deposit_rule/);
    expect(await dbError(orderWithBadDeposit(p.db, { subtotal: 50_000, depositRequired: true, depositAmount: 15_000 }))).toMatch(/orders_deposit_rule/);
    expect(await dbError(orderWithBadDeposit(p.db, { subtotal: 60_001, depositRequired: true, depositAmount: 18_000 }))).toBe("no error"); // floor(18,000.3)
  });

  it("blocks orders above the threshold while the deposit is not configured", async () => {
    await configureDeposits(false, false);
    expect(await orderWithSubtotal(50_001)).toEqual({ ok: false, error: "deposit_unconfigured" });
    // Exactly 50,000 does not trigger the threshold.
    const exact = await orderWithSubtotal(50_000);
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(await load(exact.orderId)).toMatchObject({ status: "PENDING", depositRequired: false, depositAmount: 0, depositStatus: "NOT_REQUIRED", deliveryFee: 5_000, total: 55_000 });
  });

  it("starts above-threshold orders in AWAITING_DEPOSIT with the configured amount, ignoring client fields", async () => {
    await configureDeposits(true);
    const r = await orderWithSubtotal(60_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 30% of 60,000 (delivery excluded).
    expect(await load(r.orderId)).toMatchObject({ status: "AWAITING_DEPOSIT", depositRequired: true, depositAmount: 18_000, depositStatus: "AWAITING", total: 65_000, deliveryFee: 5_000, paymentStatus: "PENDING" });
  });

  it("only an admin verification confirms; customer submission and direct updates cannot", async () => {
    await configureDeposits(true);
    const r = await orderWithSubtotal(70_000);
    if (!r.ok) throw new Error(r.error);
    const order = await load(r.orderId);

    // Generic status change cannot confirm an unverified deposit.
    expect(await changeOrderStatus(p.db, order.id, { to: "CONFIRMED", expectedFrom: "AWAITING_DEPOSIT" }, admin)).toEqual({ ok: false, error: "invalid_transition" });
    // Neither can a raw UPDATE: the database trigger refuses it.
    expect(await dbError(p.db.update(orders).set({ status: "CONFIRMED" }).where(eq(orders.id, order.id)))).toMatch(/orders_deposit_unverified/);
    expect(await dbError(p.db.update(orders).set({ depositAmount: 999_999 }).where(eq(orders.id, order.id)))).toMatch(/orders_deposit_ck|orders_deposit_rule/);
    expect(await dbError(p.db.update(orders).set({ depositAmount: 1_000 }).where(eq(orders.id, order.id)))).toMatch(/orders_deposit_rule/);

    expect(await submitDeposit(p.db, order.id, { method: "QICARD", reference: "ABC-123" }, { userId: null, label: "c" })).toEqual({ ok: false, error: "method_unavailable" });
    expect(await submitDeposit(p.db, order.id, { method: "FIB", reference: "x" }, { userId: null, label: "c" })).toEqual({ ok: false, error: "invalid_input" });
    const sub = await submitDeposit(p.db, order.id, { method: "FIB", reference: "FIB-778899" }, { userId: null, label: "c" });
    expect(sub.ok).toBe(true);
    // Submitting is not payment.
    expect(await load(order.id)).toMatchObject({ status: "DEPOSIT_SUBMITTED", depositStatus: "SUBMITTED", depositReference: "FIB-778899", paymentStatus: "PENDING", depositVerifiedAt: null });
    expect(await submitDeposit(p.db, order.id, { method: "FIB", reference: "AGAIN-1" }, { userId: null, label: "c" })).toEqual({ ok: false, error: "not_awaiting" });
    expect(await changeOrderStatus(p.db, order.id, { to: "CONFIRMED", expectedFrom: "DEPOSIT_SUBMITTED" }, admin)).toEqual({ ok: false, error: "invalid_transition" });

    // Reject: back to awaiting, with a note the customer sees.
    expect(await rejectDeposit(p.db, order.id, admin, "Transfer not found")).toEqual({ ok: true });
    expect(await load(order.id)).toMatchObject({ status: "AWAITING_DEPOSIT", depositStatus: "AWAITING", depositReference: null });
    await submitDeposit(p.db, order.id, { method: "FIB", reference: "FIB-778900" }, { userId: null, label: "c" });

    // The admin must type the amount actually received: exactly 30% of 70,000.
    expect(await verifyDeposit(p.db, order.id, admin)).toEqual({ ok: false, error: "amount_mismatch" });
    expect(await verifyDeposit(p.db, order.id, admin, undefined, new Date(), 20_000)).toEqual({ ok: false, error: "amount_mismatch" });
    expect(await verifyDeposit(p.db, order.id, admin, undefined, new Date(), 21_000)).toEqual({ ok: true });
    expect(await verifyDeposit(p.db, order.id, admin, undefined, new Date(), 21_000)).toEqual({ ok: false, error: "not_awaiting" });
    expect(await load(order.id)).toMatchObject({ status: "DEPOSIT_VERIFIED", depositStatus: "VERIFIED" });
    expect(await changeOrderStatus(p.db, order.id, { to: "CONFIRMED", expectedFrom: "DEPOSIT_VERIFIED" }, admin)).toEqual({ ok: true });
    const history = await p.db.select({ to: orderStatusHistory.toStatus }).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, order.id)).orderBy(orderStatusHistory.createdAt);
    expect(history.map((h) => h.to)).toEqual(["AWAITING_DEPOSIT", "DEPOSIT_SUBMITTED", "AWAITING_DEPOSIT", "DEPOSIT_SUBMITTED", "DEPOSIT_VERIFIED", "CONFIRMED"]);
    // Two submissions → two distinct DEPOSIT_SUBMITTED notification events.
    expect(await p.db.$count(notificationEvents, sql`${notificationEvents.orderId} = ${order.id} AND ${notificationEvents.kind} = 'DEPOSIT_SUBMITTED'`)).toBe(2);
  });

  it("lets an order awaiting a deposit be cancelled", async () => {
    await configureDeposits(true);
    const r = await orderWithSubtotal(80_000);
    if (!r.ok) throw new Error();
    expect(await changeOrderStatus(p.db, r.orderId, { to: "CANCELLED", expectedFrom: "AWAITING_DEPOSIT" }, admin)).toEqual({ ok: true });
  });
});

describe("Telegram notification outbox", () => {
  const config = { token: "123456:SECRET-BOT-TOKEN", chatIds: ["1111", "2222"], siteUrl: "https://example.test" };

  it("creates exactly one event per committed order, also on duplicate submits", async () => {
    await configureDeposits(true);
    const product = await makeProduct(p.db, { basePrice: 10_000 });
    const zone = await makeZone(p.db);
    const owner = visitor();
    await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
    const input = checkoutInput(zone.id);
    const a = await placeOrder(p.db, input, { owner, userId: null, appSecret: SECRET });
    const b = await placeOrder(p.db, input, { owner, userId: null, appSecret: SECRET });
    if (!a.ok || !b.ok) throw new Error();
    expect(b.duplicate).toBe(true);
    const events = await p.db.select().from(notificationEvents).where(eq(notificationEvents.orderId, a.orderId));
    expect(events).toHaveLength(1);
    // No personal data in the payload or the rendered message.
    const text = renderNotification(events[0].kind, events[0].payload, a.orderId, config.siteUrl);
    expect(text).toContain(a.orderNumber);
    expect(text).toContain("15,000 IQD");
    expect(text).toContain(`https://example.test/en/admin/orders/${a.orderId}`);
    expect(JSON.stringify(events[0].payload) + text).not.toMatch(/Ali Hassan|7701234567|Karrada|Street 62/);
  });

  it("records failures without touching the order, retries only missing chats, and never sends twice", async () => {
    const r = await orderWithSubtotal(12_000);
    if (!r.ok) throw new Error();
    const [event] = await p.db.select().from(notificationEvents).where(eq(notificationEvents.orderId, r.orderId));
    // Chat 1111 succeeds, 2222 hits a 500.
    const first = fakeFetch(json({ ok: true }), json({ ok: false, description: "Internal error" }, 500));
    expect(await dispatchNotification(p.db, event.id, config, { fetchImpl: first.fetchImpl })).toBe("failed");
    let [row] = await p.db.select().from(notificationEvents).where(eq(notificationEvents.id, event.id));
    expect(row).toMatchObject({ status: "FAILED", attempts: 1, deliveredTo: ["1111"] });
    expect(row.lastError).toContain("500");
    expect(row.lastError).not.toContain("SECRET-BOT-TOKEN");
    expect(row.nextAttemptAt).not.toBeNull();
    expect((await load(r.orderId)).status).toBe("PENDING");

    // Not yet due: an automatic run skips it.
    const early = fakeFetch(json({ ok: true }));
    expect(await dispatchNotification(p.db, event.id, config, { fetchImpl: early.fetchImpl })).toBe("skipped");
    expect(early.calls).toHaveLength(0);

    // Due retry sends only to the chat that failed.
    const retry = fakeFetch(json({ ok: true }));
    await dispatchPending(p.db, config, [], { fetchImpl: retry.fetchImpl, now: Date.now() + 10 * 60_000, limit: 50 });
    // Other due events may be retried in the same run; look only at this order's messages.
    const mine = retry.calls.map((c) => JSON.parse(String(c.init?.body))).filter((b) => String(b.text).includes(r.orderNumber));
    expect(mine.map((b) => b.chat_id)).toEqual(["2222"]);
    expect(retry.calls[0].url).toContain("/sendMessage");
    [row] = await p.db.select().from(notificationEvents).where(eq(notificationEvents.id, event.id));
    expect(row).toMatchObject({ status: "SENT", deliveredTo: ["1111", "2222"] });

    // Sent events are never sent again, even by a manual retry.
    const again = fakeFetch(json({ ok: true }));
    expect(await retryNotification(p.db, event.id, config, { adminId: null, label: "owner" }, again.fetchImpl)).toBe("skipped");
    expect(again.calls).toHaveLength(0);
  });

  it("waits for configuration instead of failing silently, and network errors are retryable", async () => {
    const r = await orderWithSubtotal(13_000);
    if (!r.ok) throw new Error();
    const [event] = await p.db.select().from(notificationEvents).where(eq(notificationEvents.orderId, r.orderId));
    expect(await dispatchNotification(p.db, event.id, null)).toBe("not_configured");
    expect((await p.db.select().from(notificationEvents).where(eq(notificationEvents.id, event.id)))[0].status).toBe("NOT_CONFIGURED");
    const down = fakeFetch(new TypeError("fetch failed"));
    expect(await dispatchNotification(p.db, event.id, config, { fetchImpl: down.fetchImpl, manual: true })).toBe("failed");
    const [row] = await p.db.select().from(notificationEvents).where(eq(notificationEvents.id, event.id));
    expect(row.nextAttemptAt).not.toBeNull();
  });

  it("records each owner as soon as their message is sent, so a crash mid-loop can never double-send", async () => {
    const r = await orderWithSubtotal(15_000);
    if (!r.ok) throw new Error();
    const [event] = await p.db.select().from(notificationEvents).where(eq(notificationEvents.orderId, r.orderId));
    const sentTo: string[] = [];
    let seenBeforeSecond: string[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const chat = JSON.parse(String(init?.body)).chat_id as string;
      sentTo.push(chat);
      if (chat === "2222") {
        // Owner 1 must already be persisted before owner 2 is attempted.
        seenBeforeSecond = (await p.db.select().from(notificationEvents).where(eq(notificationEvents.id, event.id)))[0].deliveredTo;
        return json({ ok: false, description: "Internal error" }, 500);
      }
      return json({ ok: true });
    };
    expect(await dispatchNotification(p.db, event.id, config, { fetchImpl })).toBe("failed");
    expect(seenBeforeSecond).toEqual(["1111"]);
    // Simulate a Worker that died while SENDING: the lock expires and another run picks it up.
    await p.db.update(notificationEvents).set({ status: "SENDING", lockedUntil: new Date(Date.now() - 1) }).where(eq(notificationEvents.id, event.id));
    sentTo.length = 0;
    const again = fakeFetch(json({ ok: true }));
    expect(await dispatchNotification(p.db, event.id, config, { fetchImpl: again.fetchImpl, manual: true })).toBe("sent");
    expect(again.calls.map((c) => JSON.parse(String(c.init?.body)).chat_id)).toEqual(["2222"]);
  });

  it("parses owner chat ids strictly and reports ignored entries", async () => {
    const { parseChatIds, parseChatIdsStrict } = await import("@/server/integrations/telegram");
    expect(parseChatIds("1234567890,2345678901")).toEqual(["1234567890", "2345678901"]);
    expect(parseChatIds(" 1234567890 ; 2345678901,1234567890 ")).toEqual(["1234567890", "2345678901"]);
    expect(parseChatIdsStrict("1234567890,234567890x,@owner")).toEqual({ ids: ["1234567890"], invalid: 2 });
  });

  it("a permanently rejected chat id waits for a manual retry", async () => {
    const r = await orderWithSubtotal(14_000);
    if (!r.ok) throw new Error();
    const [event] = await p.db.select().from(notificationEvents).where(eq(notificationEvents.orderId, r.orderId));
    const bad = fakeFetch(json({ ok: false, description: "Bad Request: chat not found" }, 400));
    expect(await dispatchNotification(p.db, event.id, { ...config, chatIds: ["3333"] }, { fetchImpl: bad.fetchImpl })).toBe("failed");
    const [row] = await p.db.select().from(notificationEvents).where(eq(notificationEvents.id, event.id));
    expect(row.nextAttemptAt).toBeNull();
    expect(row.lastError).toContain("chat not found");
  });
});
