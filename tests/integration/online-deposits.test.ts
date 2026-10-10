import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs, depositPayments, notificationEvents, orders, orderStatusHistory } from "@/server/db/schema";
import { createFibProvider, type DepositProvider, type ProviderStatus } from "@/server/integrations/fib";
import { addToCart } from "@/server/services/cart";
import { changeOrderStatus } from "@/server/services/admin-orders";
import { checkOnlineDeposit, startOnlineDeposit } from "@/server/services/online-deposits";
import { placeOrder } from "@/server/services/orders";
import { startPlatform, type TestPlatform } from "../support/platform";
import { checkoutInput, makeProduct, makeZone } from "../support/fixtures";
import { fakeFetch, json } from "../support/fakes";

let p: TestPlatform;
const SECRET = "test-app-secret-at-least-32-characters-long";
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

/** In-memory provider: payments are created with increasing ids; tests set each one's remote status. */
function fakeProvider() {
  const remote = new Map<string, ProviderStatus>();
  const created: { amount: number; callbackUrl: string; description: string }[] = [];
  let n = 0;
  let failCreate = false;
  const prefix = crypto.randomUUID().slice(0, 8);
  const id = (i: number) => `fib-${prefix}-${i}`;
  const provider: DepositProvider = {
    name: "FIB",
    async createPayment(input) {
      if (failCreate) return { ok: false, detail: "down" };
      created.push(input);
      const pid = id(++n);
      remote.set(pid, { status: "UNPAID", amount: input.amount, currency: "IQD", paidAt: null, declineReason: null });
      return { ok: true, payment: { providerPaymentId: pid, validUntil: new Date(Date.now() + 15 * 60_000), payInfo: { readableCode: `CODE${n}`, personalAppLink: "https://example.test/pay", qrCode: null, businessAppLink: null, corporateAppLink: null } } };
    },
    async getStatus(id) {
      const s = remote.get(id);
      return s ? { ok: true, status: s } : { ok: false, detail: "404" };
    },
  };
  return { provider, remote, created, id, setFailCreate: (v: boolean) => (failCreate = v) };
}

async function highValueOrder(subtotal = 80_000) {
  const product = await makeProduct(p.db, { basePrice: subtotal });
  const zone = await makeZone(p.db);
  const owner = { visitorHash: crypto.randomUUID().replace(/-/g, "") };
  await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
  const r = await placeOrder(p.db, checkoutInput(zone.id), { owner, userId: null, appSecret: SECRET, onlineDepositAvailable: true });
  if (!r.ok) throw new Error(r.error);
  return r;
}
const load = async (id: string) => (await p.db.select().from(orders).where(eq(orders.id, id)))[0];
const cb = "https://shop.test/api/payments/fib/callback";

describe("FIB adapter (request shapes per FIB's public docs)", () => {
  it("authenticates with client credentials, creates an IQD payment, and reads the status", async () => {
    const f = fakeFetch(
      json({ access_token: "tok-1", expires_in: 60 }),
      json({ paymentId: "p-1", readableCode: "ABC", personalAppLink: "https://fib/p", qrCode: "iVBOR", validUntil: "2026-10-10T12:00:00Z" }, 202),
      json({ access_token: "tok-2" }),
      json({ paymentId: "p-1", status: "PAID", paidAt: "2026-10-10T11:00:00Z", amount: { amount: 24000, currency: "IQD" } }),
    );
    const fib = createFibProvider({ baseUrl: "https://fib.stage.fib.iq/", clientId: "client", clientSecret: "SUPER-SECRET-VALUE" }, f.fetchImpl);
    const created = await fib.createPayment({ amount: 24_000, callbackUrl: cb, description: "RoboNest.3D deposit RN-261010-ABCDEF and more text to cut" });
    expect(created).toMatchObject({ ok: true, payment: { providerPaymentId: "p-1", payInfo: { readableCode: "ABC" } } });
    expect(f.calls[0].url).toBe("https://fib.stage.fib.iq/auth/realms/fib-online-shop/protocol/openid-connect/token");
    expect(String(f.calls[0].init?.body)).toContain("grant_type=client_credentials");
    expect(f.calls[1].url).toBe("https://fib.stage.fib.iq/protected/v1/payments");
    const body = JSON.parse(String(f.calls[1].init?.body));
    expect(body).toMatchObject({ monetaryValue: { amount: 24_000, currency: "IQD" }, statusCallbackUrl: cb });
    expect(body.description.length).toBeLessThanOrEqual(50);
    const status = await fib.getStatus("p-1");
    expect(status).toMatchObject({ ok: true, status: { status: "PAID", amount: 24_000, currency: "IQD" } });
    expect(f.calls[3].url).toBe("https://fib.stage.fib.iq/protected/v1/payments/p-1/status");
  });

  it("rejects unexpected statuses, mismatched payment ids, and never leaks the client secret", async () => {
    const odd = fakeFetch(json({ access_token: "t" }), json({ paymentId: "p-2", status: "MAYBE" }));
    expect(await createFibProvider({ baseUrl: "https://x.test", clientId: "c", clientSecret: "SUPER-SECRET-VALUE" }, odd.fetchImpl).getStatus("p-2")).toMatchObject({ ok: false });
    const other = fakeFetch(json({ access_token: "t" }), json({ paymentId: "someone-else", status: "PAID", amount: { amount: 1, currency: "IQD" } }));
    expect(await createFibProvider({ baseUrl: "https://x.test", clientId: "c", clientSecret: "SUPER-SECRET-VALUE" }, other.fetchImpl).getStatus("p-2")).toMatchObject({ ok: false });
    const echo = fakeFetch(json({ access_token: "t" }), new Response("bad request SUPER-SECRET-VALUE", { status: 406 }));
    const res = await createFibProvider({ baseUrl: "https://x.test", clientId: "c", clientSecret: "SUPER-SECRET-VALUE" }, echo.fetchImpl).createPayment({ amount: 1, callbackUrl: cb, description: "d" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).not.toContain("SUPER-SECRET-VALUE");
  });
});

describe("online deposit flow", () => {
  it("requests exactly the 30% deposit and reuses the open payment on duplicate submissions", async () => {
    const f = fakeProvider();
    const order = await highValueOrder(80_000);
    const a = await startOnlineDeposit(p.db, f.provider, order.orderId, { callbackUrl: cb });
    const b = await startOnlineDeposit(p.db, f.provider, order.orderId, { callbackUrl: cb });
    expect(a).toMatchObject({ ok: true, reused: false });
    expect(b).toMatchObject({ ok: true, reused: true });
    expect(f.created).toHaveLength(1);
    expect(f.created[0].amount).toBe(24_000);
    expect(await p.db.$count(depositPayments, eq(depositPayments.orderId, order.orderId))).toBe(1);
  });

  it("does nothing while unpaid, records declines, and lets the customer try again", async () => {
    const f = fakeProvider();
    const order = await highValueOrder();
    const start = await startOnlineDeposit(p.db, f.provider, order.orderId, { callbackUrl: cb });
    if (!start.ok) throw new Error();
    expect(await checkOnlineDeposit(p.db, f.provider, { paymentId: start.paymentId })).toBe("unpaid");
    f.remote.set(f.id(1), { status: "DECLINED", amount: 24_000, currency: "IQD", paidAt: null, declineReason: "PAYMENT_EXPIRATION" });
    expect(await checkOnlineDeposit(p.db, f.provider, { providerPaymentId: f.id(1) })).toBe("declined");
    expect(await load(order.orderId)).toMatchObject({ status: "AWAITING_DEPOSIT", depositStatus: "AWAITING" });
    const retry = await startOnlineDeposit(p.db, f.provider, order.orderId, { callbackUrl: cb });
    expect(retry).toMatchObject({ ok: true, reused: false });
  });

  it("verifies only on a provider-confirmed PAID status, idempotently under repeated callbacks", async () => {
    const f = fakeProvider();
    const order = await highValueOrder(80_000);
    await startOnlineDeposit(p.db, f.provider, order.orderId, { callbackUrl: cb });
    f.remote.set(f.id(1), { status: "PAID", amount: 24_000, currency: "IQD", paidAt: new Date(), declineReason: null });
    const outcomes = await Promise.all([1, 2, 3].map(() => checkOnlineDeposit(p.db, f.provider, { providerPaymentId: f.id(1) })));
    expect(outcomes.filter((o) => o === "verified")).toHaveLength(1);
    expect(outcomes.every((o) => o === "verified" || o === "already_verified")).toBe(true);
    expect(await checkOnlineDeposit(p.db, f.provider, { providerPaymentId: f.id(1) })).toBe("already_verified");
    expect(await load(order.orderId)).toMatchObject({ status: "DEPOSIT_VERIFIED", depositStatus: "VERIFIED", depositMethod: "FIB", depositReference: f.id(1), paymentStatus: "PENDING" });
    expect(await p.db.$count(orderStatusHistory, and(eq(orderStatusHistory.orderId, order.orderId), eq(orderStatusHistory.toStatus, "DEPOSIT_VERIFIED")))).toBe(1);
    expect(await p.db.$count(notificationEvents, and(eq(notificationEvents.orderId, order.orderId), eq(notificationEvents.kind, "DEPOSIT_PAID")))).toBe(1);
    // Staff can now confirm the order.
    expect(await changeOrderStatus(p.db, order.orderId, { to: "CONFIRMED", expectedFrom: "DEPOSIT_VERIFIED" }, { adminId: null, label: "owner" })).toEqual({ ok: true });
  });

  it("never verifies a wrong amount or currency", async () => {
    const f = fakeProvider();
    const order = await highValueOrder(80_000);
    await startOnlineDeposit(p.db, f.provider, order.orderId, { callbackUrl: cb });
    f.remote.set(f.id(1), { status: "PAID", amount: 1_000, currency: "IQD", paidAt: new Date(), declineReason: null });
    expect(await checkOnlineDeposit(p.db, f.provider, { providerPaymentId: f.id(1) })).toBe("amount_mismatch");
    f.remote.set(f.id(1), { status: "PAID", amount: 24_000, currency: "USD", paidAt: new Date(), declineReason: null });
    expect(await checkOnlineDeposit(p.db, f.provider, { providerPaymentId: f.id(1) })).toBe("amount_mismatch");
    expect(await load(order.orderId)).toMatchObject({ status: "AWAITING_DEPOSIT", depositStatus: "AWAITING" });
    expect(await p.db.$count(auditLogs, eq(auditLogs.action, "order.deposit.online_mismatch"))).toBeGreaterThan(0);
  });

  it("flags payments that arrive after cancellation or twice, for a manual refund", async () => {
    const f = fakeProvider();
    const cancelled = await highValueOrder(80_000);
    await startOnlineDeposit(p.db, f.provider, cancelled.orderId, { callbackUrl: cb });
    expect(await changeOrderStatus(p.db, cancelled.orderId, { to: "CANCELLED", expectedFrom: "AWAITING_DEPOSIT" }, { adminId: null, label: "owner" })).toEqual({ ok: true });
    f.remote.set(f.id(1), { status: "PAID", amount: 24_000, currency: "IQD", paidAt: new Date(), declineReason: null });
    expect(await checkOnlineDeposit(p.db, f.provider, { providerPaymentId: f.id(1) })).toBe("paid_but_order_closed");
    expect((await load(cancelled.orderId)).status).toBe("CANCELLED");
    expect(await p.db.$count(auditLogs, eq(auditLogs.action, "order.deposit.paid_after_close"))).toBe(1);

    const g = fakeProvider();
    const twice = await highValueOrder(80_000);
    await startOnlineDeposit(p.db, g.provider, twice.orderId, { callbackUrl: cb });
    // First payment expires (declined); the customer starts a second one but pays BOTH.
    g.remote.set(g.id(1), { status: "DECLINED", amount: 24_000, currency: "IQD", paidAt: null, declineReason: "PAYMENT_EXPIRATION" });
    await checkOnlineDeposit(p.db, g.provider, { providerPaymentId: g.id(1) });
    await startOnlineDeposit(p.db, g.provider, twice.orderId, { callbackUrl: cb });
    g.remote.set(g.id(2), { status: "PAID", amount: 24_000, currency: "IQD", paidAt: new Date(), declineReason: null });
    expect(await checkOnlineDeposit(p.db, g.provider, { providerPaymentId: g.id(2) })).toBe("verified");
    g.remote.set(g.id(1), { status: "PAID", amount: 24_000, currency: "IQD", paidAt: new Date(), declineReason: null });
    expect(await checkOnlineDeposit(p.db, g.provider, { providerPaymentId: g.id(1) })).toBe("already_verified");
    expect(await p.db.$count(auditLogs, eq(auditLogs.action, "order.deposit.duplicate_payment"))).toBe(1);
  });

  it("does not start payments for orders that need no deposit, and survives provider outages", async () => {
    const f = fakeProvider();
    const product = await makeProduct(p.db, { basePrice: 10_000 });
    const zone = await makeZone(p.db);
    const owner = { visitorHash: crypto.randomUUID().replace(/-/g, "") };
    await addToCart(p.db, owner, { productId: product.id, quantity: 1, options: {} });
    const small = await placeOrder(p.db, checkoutInput(zone.id), { owner, userId: null, appSecret: SECRET, onlineDepositAvailable: true });
    if (!small.ok) throw new Error();
    expect(await startOnlineDeposit(p.db, f.provider, small.orderId, { callbackUrl: cb })).toEqual({ ok: false, error: "not_awaiting" });
    const big = await highValueOrder();
    f.setFailCreate(true);
    expect(await startOnlineDeposit(p.db, f.provider, big.orderId, { callbackUrl: cb })).toEqual({ ok: false, error: "provider_failed" });
    expect(await checkOnlineDeposit(p.db, f.provider, { providerPaymentId: "unknown" })).toBe("unknown_payment");
  });
});
