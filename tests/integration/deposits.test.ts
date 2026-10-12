import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { notificationEvents, orders, orderStatusHistory } from "@/server/db/schema";
import { addToCart } from "@/server/services/cart";
import { changeOrderStatus } from "@/server/services/admin-orders";
import { placeOrder } from "@/server/services/orders";
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

async function orderWithSubtotal(subtotal: number) {
  const product = await makeProduct(p.db, { basePrice: subtotal });
  const zone = await makeZone(p.db, { fee: 9_000 }); // legacy fee: must be ignored
  const owner = visitor();
  await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
  return placeOrder(p.db, { ...checkoutInput(zone.id), total: 1, depositAmount: 0, status: "CONFIRMED", paymentStatus: "PAID" }, { owner, userId: null, appSecret: SECRET });
}

const load = async (id: string) => (await p.db.select().from(orders).where(eq(orders.id, id)))[0];

describe("high-value orders (manual WhatsApp deposit)", () => {
  it("are always payable: no provider or fallback approval is needed any more", async () => {
    const r = await orderWithSubtotal(55_555);
    if (!r.ok) throw new Error(r.error);
    // floor(55,555 × 30%) = 16,666
    expect(await load(r.orderId)).toMatchObject({ status: "AWAITING_DEPOSIT", depositAmount: 16_666, depositStatus: "AWAITING", paymentStatus: "PENDING" });
  });

  it("applies discounts before the threshold and the 30% (delivery never counts)", async () => {
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

  it("exactly 50,000 needs no deposit; 50,001 does", async () => {
    const exact = await orderWithSubtotal(50_000);
    if (!exact.ok) throw new Error(exact.error);
    expect(await load(exact.orderId)).toMatchObject({ status: "PENDING", depositRequired: false, depositAmount: 0, depositStatus: "NOT_REQUIRED", deliveryFee: 5_000, total: 55_000 });
    const above = await orderWithSubtotal(50_001);
    if (!above.ok) throw new Error(above.error);
    expect(await load(above.orderId)).toMatchObject({ status: "AWAITING_DEPOSIT", depositRequired: true, depositAmount: 15_000 });
  });

  it("starts above-threshold orders in AWAITING_DEPOSIT with the computed amount, ignoring client fields", async () => {
    const r = await orderWithSubtotal(60_000);
    if (!r.ok) throw new Error(r.error);
    // 30% of 60,000 (delivery excluded); the client's status/paymentStatus/total are ignored.
    expect(await load(r.orderId)).toMatchObject({ status: "AWAITING_DEPOSIT", depositRequired: true, depositAmount: 18_000, depositStatus: "AWAITING", total: 65_000, deliveryFee: 5_000, paymentStatus: "PENDING" });
  });

  it("the generic status change and raw updates cannot skip the deposit", async () => {
    const r = await orderWithSubtotal(70_000);
    if (!r.ok) throw new Error(r.error);
    expect(await changeOrderStatus(p.db, r.orderId, { to: "CONFIRMED", expectedFrom: "AWAITING_DEPOSIT" }, admin)).toEqual({ ok: false, error: "invalid_transition" });
    expect(await dbError(p.db.update(orders).set({ status: "CONFIRMED" }).where(eq(orders.id, r.orderId)))).toMatch(/orders_deposit_unverified/);
    expect(await dbError(p.db.update(orders).set({ depositAmount: 999_999 }).where(eq(orders.id, r.orderId)))).toMatch(/orders_deposit_ck|orders_deposit_rule/);
    expect(await dbError(p.db.update(orders).set({ depositAmount: 1_000 }).where(eq(orders.id, r.orderId)))).toMatch(/orders_deposit_rule/);
    // Marking the deposit verified directly is refused without a verification record (migration 0005).
    expect(await dbError(p.db.update(orders).set({ status: "DEPOSIT_VERIFIED", depositStatus: "VERIFIED" }).where(eq(orders.id, r.orderId)))).toMatch(/deposit_not_verified/);
    const history = await p.db.select({ to: orderStatusHistory.toStatus }).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, r.orderId));
    expect(history.map((h) => h.to)).toEqual(["AWAITING_DEPOSIT"]);
    expect(await p.db.$count(notificationEvents, sql`${notificationEvents.orderId} = ${r.orderId} AND ${notificationEvents.kind} = 'DEPOSIT_SUBMITTED'`)).toBe(0);
  });

  it("lets an order awaiting a deposit be cancelled", async () => {
    const r = await orderWithSubtotal(80_000);
    if (!r.ok) throw new Error();
    expect(await changeOrderStatus(p.db, r.orderId, { to: "CANCELLED", expectedFrom: "AWAITING_DEPOSIT" }, admin)).toEqual({ ok: true });
  });
});

describe("Telegram notification outbox", () => {
  const config = { token: "123456:SECRET-BOT-TOKEN", chatIds: ["1111", "2222"], siteUrl: "https://example.test" };

  it("creates exactly one event per committed order, also on duplicate submits", async () => {
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
