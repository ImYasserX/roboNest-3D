import { and, desc, eq, gt, inArray, ne } from "drizzle-orm";
import { runBatch, type Database } from "@/server/db/client";
import { depositPayments, orders, orderStatusHistory } from "@/server/db/schema";
import type { DepositProvider } from "@/server/integrations/fib";
import { depositAmountFor, depositBase } from "@/lib/payment-rules";
import { auditInsert } from "./audit";
import { depositPaidEvent } from "./notifications";

// Online deposit payments (FIB). Rules:
// - The amount requested is always orders.deposit_amount, which the database
//   guarantees equals 30% of the deposit base.
// - A deposit counts as paid ONLY when the provider's authenticated status
//   endpoint reports PAID for the exact amount in IQD. Callback bodies,
//   redirects and customer claims are never trusted.
// - Every step is idempotent: repeated callbacks, refreshes and retries end
//   in the same state and never create a second confirmation.

const SYSTEM = { adminId: null, label: "system:FIB" } as const;
/** Reuse an open provider payment while it stays valid for at least this long. */
const REUSE_MARGIN_MS = 2 * 60 * 1000;

export type StartResult =
  | { ok: true; paymentId: string; payInfo: Record<string, string | null>; validUntil: Date | null; reused: boolean }
  | { ok: false; error: "not_found" | "not_awaiting" | "provider_failed" };

export async function startOnlineDeposit(db: Database, provider: DepositProvider, orderId: string, opts: { callbackUrl: string; now?: Date }): Promise<StartResult> {
  const now = opts.now ?? new Date();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, error: "not_found" };
  if (!order.depositRequired || order.status !== "AWAITING_DEPOSIT" || order.depositStatus === "VERIFIED") return { ok: false, error: "not_awaiting" };

  // Duplicate submissions (double clicks, refreshes) reuse the open payment.
  const [open] = await db
    .select()
    .from(depositPayments)
    .where(and(eq(depositPayments.orderId, orderId), eq(depositPayments.status, "CREATED"), gt(depositPayments.validUntil, new Date(now.getTime() + REUSE_MARGIN_MS))))
    .orderBy(desc(depositPayments.createdAt))
    .limit(1);
  if (open) return { ok: true, paymentId: open.id, payInfo: open.payInfo, validUntil: open.validUntil, reused: true };

  const created = await provider.createPayment({ amount: order.depositAmount, callbackUrl: opts.callbackUrl, description: `RoboNest.3D deposit ${order.orderNumber}` });
  if (!created.ok) {
    console.error("online deposit create failed", { provider: provider.name, detail: created.detail });
    return { ok: false, error: "provider_failed" };
  }
  const id = crypto.randomUUID();
  await db.insert(depositPayments).values({
    id,
    orderId,
    provider: provider.name,
    providerPaymentId: created.payment.providerPaymentId,
    amount: order.depositAmount,
    payInfo: created.payment.payInfo,
    validUntil: created.payment.validUntil,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, paymentId: id, payInfo: created.payment.payInfo, validUntil: created.payment.validUntil, reused: false };
}

export type CheckOutcome = "verified" | "already_verified" | "unpaid" | "declined" | "amount_mismatch" | "paid_but_order_closed" | "unknown_payment" | "provider_error";

/**
 * Re-checks one provider payment with the provider and applies the result.
 * Safe to call any number of times (callback, customer "check" button, admin).
 */
export async function checkOnlineDeposit(db: Database, provider: DepositProvider, ref: { providerPaymentId: string } | { paymentId: string }, now = new Date()): Promise<CheckOutcome> {
  const [payment] = await db
    .select()
    .from(depositPayments)
    .where("paymentId" in ref ? eq(depositPayments.id, ref.paymentId) : and(eq(depositPayments.provider, provider.name), eq(depositPayments.providerPaymentId, ref.providerPaymentId)))
    .limit(1);
  if (!payment) return "unknown_payment";

  const remote = await provider.getStatus(payment.providerPaymentId);
  await db.update(depositPayments).set({ lastCheckedAt: now }).where(eq(depositPayments.id, payment.id));
  if (!remote.ok) {
    console.error("online deposit status check failed", { provider: provider.name, detail: remote.detail });
    return "provider_error";
  }
  const s = remote.status;
  if (s.status === "UNPAID") return "unpaid";
  if (s.status === "DECLINED") {
    await db.update(depositPayments).set({ status: "DECLINED", declineReason: s.declineReason?.slice(0, 60) ?? null }).where(and(eq(depositPayments.id, payment.id), eq(depositPayments.status, "CREATED")));
    return "declined";
  }

  // PAID: amount and currency must match exactly what we asked for.
  const [order] = await db.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1);
  const expected = order ? depositAmountFor(depositBase(order.subtotal, order.discountTotal)) : -1;
  const amountOk = s.currency === "IQD" && s.amount === payment.amount && payment.amount === order?.depositAmount && payment.amount === expected;
  if (!order || !amountOk) {
    await db.update(depositPayments).set({ status: "AMOUNT_MISMATCH", paidAt: s.paidAt }).where(and(eq(depositPayments.id, payment.id), inArray(depositPayments.status, ["CREATED", "DECLINED"])));
    if (order) await auditInsert(db, SYSTEM, { action: "order.deposit.online_mismatch", targetType: "order", targetId: order.id, metadata: { orderNumber: order.orderNumber, expected: payment.amount, reported: s.amount, currency: s.currency } });
    return "amount_mismatch";
  }

  // Mark the provider payment paid (idempotent; a crash after this step is
  // healed by the next check, because the order update below is retried).
  await db
    .update(depositPayments)
    .set({ status: "PAID", paidAt: s.paidAt ?? now })
    .where(and(eq(depositPayments.id, payment.id), ne(depositPayments.status, "PAID")));

  if (order.depositStatus === "VERIFIED") {
    // Already verified: by this payment (repeat callback) or by another one (double payment).
    const confirmedByThis = order.depositReference === payment.providerPaymentId;
    if (!confirmedByThis) {
      await auditInsert(db, SYSTEM, { action: "order.deposit.duplicate_payment", targetType: "order", targetId: order.id, metadata: { orderNumber: order.orderNumber, providerPaymentId: payment.providerPaymentId, amount: payment.amount } });
    }
    return "already_verified";
  }

  const claimed = await db
    .update(orders)
    .set({ status: "DEPOSIT_VERIFIED", depositStatus: "VERIFIED", depositMethod: "FIB", depositReference: payment.providerPaymentId, depositSubmittedAt: s.paidAt ?? now, depositVerifiedAt: now, depositVerifiedBy: null })
    .where(and(eq(orders.id, order.id), inArray(orders.status, ["AWAITING_DEPOSIT", "DEPOSIT_SUBMITTED"]), ne(orders.depositStatus, "VERIFIED")))
    .returning({ id: orders.id });
  if (claimed.length !== 1) {
    // Paid while the order was cancelled (or changed meanwhile): staff must refund by hand.
    const [fresh] = await db.select({ depositStatus: orders.depositStatus, depositReference: orders.depositReference }).from(orders).where(eq(orders.id, order.id)).limit(1);
    if (fresh?.depositStatus === "VERIFIED") return "already_verified";
    await auditInsert(db, SYSTEM, { action: "order.deposit.paid_after_close", targetType: "order", targetId: order.id, metadata: { orderNumber: order.orderNumber, status: order.status, providerPaymentId: payment.providerPaymentId, amount: payment.amount } });
    return "paid_but_order_closed";
  }

  await runBatch(db, [
    db.insert(orderStatusHistory).values({ orderId: order.id, fromStatus: order.status, toStatus: "DEPOSIT_VERIFIED", actorType: "SYSTEM", actorId: null, actorLabel: "FIB", createdAt: now }),
    auditInsert(db, SYSTEM, { action: "order.deposit.verified_online", targetType: "order", targetId: order.id, metadata: { orderNumber: order.orderNumber, provider: provider.name, providerPaymentId: payment.providerPaymentId, amount: payment.amount } }),
    depositPaidEvent(db, { id: order.id, orderNumber: order.orderNumber, total: order.total, depositAmount: payment.amount, providerPaymentId: payment.providerPaymentId }, now),
  ]);
  return "verified";
}

/** The newest provider payment for an order (for the order page); `open` = created and still valid. */
export async function latestOnlinePayment(db: Database, orderId: string, now = Date.now()) {
  const [row] = await db
    .select({ id: depositPayments.id, status: depositPayments.status, payInfo: depositPayments.payInfo, validUntil: depositPayments.validUntil })
    .from(depositPayments)
    .where(eq(depositPayments.orderId, orderId))
    .orderBy(desc(depositPayments.createdAt))
    .limit(1);
  return row ? { ...row, open: row.status === "CREATED" && (!row.validUntil || row.validUntil.getTime() > now) } : null;
}
