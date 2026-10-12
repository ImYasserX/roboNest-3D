import { and, desc, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type BatchStatement, type Database } from "@/server/db/client";
import { adminUsers, orders, orderStatusHistory, paymentVerifications } from "@/server/db/schema";
import { PAYMENT_CHANNELS, PAYMENT_VERIFICATION_ACTIONS, PAYMENT_VERIFICATION_KINDS, type PaymentVerificationKind } from "@/lib/domain";
import { depositAmountFor, depositBase } from "@/lib/payment-rules";
import { paymentDue } from "@/lib/payment-due";
import { escapeLike } from "@/lib/search-normalize";
import { auditInsert, type AuditActor } from "./audit";

// Manual payment verification. Customers pay RoboNest.3D directly and contact
// the team on WhatsApp; NOTHING a customer does (opening WhatsApp, typing a
// reference, uploading a screenshot, returning from a payment page) changes a
// payment. Only an admin holding payments.verify can, through this module:
//
//   confirmPayment   DEPOSIT: AWAITING_DEPOSIT / DEPOSIT_SUBMITTED → DEPOSIT_VERIFIED
//                    FULL:    payment PENDING / DISPUTED → PAID (unlocks downloads)
//   disputePayment   DEPOSIT: legacy DEPOSIT_SUBMITTED → AWAITING_DEPOSIT (or stays AWAITING)
//                    FULL:    payment PENDING → DISPUTED
//   recordRefund     FULL: PAID → REFUNDED; DEPOSIT: noted on a cancelled order
//
// Every decision is one append-only payment_verifications row plus an audit
// entry, written in the same D1 batch (one transaction) as the order change.
// Amounts come from the order row; the admin must re-type the amount they saw,
// and it must match. Database triggers (migration 0005) refuse PAID / VERIFIED
// without a CONFIRMED row, a second confirmation, a wrong amount, or a
// confirmation for an order that is not waiting for that payment.

const noControl = (s: string) => !/[\u0000-\u001F\u007F]/.test(s);
const note = (min: number) => z.string().trim().min(min).max(500).refine(noControl, "invalid_characters");

export const confirmPaymentSchema = z.object({
  kind: z.enum(PAYMENT_VERIFICATION_KINDS),
  /** The amount the admin saw arrive, typed again in the confirmation dialog. */
  receivedAmount: z.preprocess((v) => (typeof v === "string" ? Number(v.replace(/[,\s]/g, "")) : v), z.number().int().positive().max(100_000_000)),
  channel: z.enum(PAYMENT_CHANNELS),
  note: note(0).optional().default(""),
  /** The admin ticked "I checked the actual payment". */
  checked: z.literal(true),
});

export const disputePaymentSchema = z.object({ kind: z.enum(PAYMENT_VERIFICATION_KINDS), reason: note(3), publicNote: note(0).optional().default("") });
export const refundSchema = z.object({ kind: z.enum(PAYMENT_VERIFICATION_KINDS), reason: note(3), confirmText: z.literal("REFUNDED") });

export type PaymentDecisionError =
  | "not_found"
  | "invalid_input"
  | "not_due"
  | "wrong_kind"
  | "amount_mismatch"
  | "already_confirmed"
  | "conflict"
  | "not_refundable";

type Admin = AuditActor & { adminId: string };
type Result = { ok: true } | { ok: false; error: PaymentDecisionError };

async function loadOrder(db: Database, orderId: string) {
  if (!z.string().uuid().safeParse(orderId).success) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return order ?? null;
}

function dbError(error: unknown): PaymentDecisionError | null {
  const text = String((error as { cause?: unknown })?.cause ?? error);
  if (/UNIQUE constraint failed: payment_verifications/.test(text)) return "already_confirmed";
  if (/payment_not_due|payment_not_verified|deposit_not_verified|orders_deposit_unverified/.test(text)) return "conflict";
  if (/payment_amount_mismatch/.test(text)) return "amount_mismatch";
  return null;
}

/** Confirms receipt of the deposit or of the outstanding amount. */
export async function confirmPayment(db: Database, orderId: string, raw: unknown, actor: Admin, now = new Date()): Promise<Result> {
  const parsed = confirmPaymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: "not_found" };
  const due = paymentDue(order);
  if (!due) return { ok: false, error: "not_due" };
  if (due.kind !== parsed.data.kind) return { ok: false, error: "wrong_kind" };
  // The deposit stored on the order must still follow the 30 % rule (also a trigger).
  if (due.kind === "DEPOSIT" && order.depositAmount !== depositAmountFor(depositBase(order.subtotal, order.discountTotal))) return { ok: false, error: "amount_mismatch" };
  if (parsed.data.receivedAmount !== due.amount) return { ok: false, error: "amount_mismatch" };

  const verificationId = crypto.randomUUID();
  const statements: BatchStatement[] = [
    db.insert(paymentVerifications).values({
      id: verificationId,
      orderId,
      kind: due.kind,
      action: "CONFIRMED",
      amount: due.amount,
      channel: parsed.data.channel,
      note: parsed.data.note || null,
      adminId: actor.adminId,
      adminLabel: actor.label,
      createdAt: now,
    }),
  ];
  if (due.kind === "DEPOSIT") {
    statements.push(
      db.update(orders).set({ status: "DEPOSIT_VERIFIED", depositStatus: "VERIFIED", depositVerifiedAt: now, depositVerifiedBy: actor.adminId }).where(eq(orders.id, orderId)),
      db.insert(orderStatusHistory).values({ orderId, fromStatus: order.status, toStatus: "DEPOSIT_VERIFIED", actorType: "ADMIN", actorId: actor.adminId, actorLabel: actor.label, createdAt: now }),
    );
  } else {
    statements.push(db.update(orders).set({ paymentStatus: "PAID" }).where(eq(orders.id, orderId)));
  }
  statements.push(
    auditInsert(db, actor, {
      action: due.kind === "DEPOSIT" ? "payment.deposit.confirmed" : "payment.full.confirmed",
      targetType: "order",
      targetId: orderId,
      metadata: { orderNumber: order.orderNumber, amount: due.amount, currency: order.currency, channel: parsed.data.channel, verificationId },
    }),
  );
  try {
    await runBatch(db, statements);
  } catch (error) {
    const code = dbError(error);
    if (code) return { ok: false, error: code };
    throw error;
  }
  return { ok: true };
}

/**
 * Staff could not confirm a claimed payment. Never deletes anything and never
 * releases files. DEPOSIT: a legacy reported reference is cleared and the
 * order waits for the deposit again. FULL: payment becomes DISPUTED.
 */
export async function disputePayment(db: Database, orderId: string, raw: unknown, actor: Admin, now = new Date()): Promise<Result> {
  const parsed = disputePaymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: "not_found" };
  const due = paymentDue(order);
  if (!due) return { ok: false, error: "not_due" };
  if (due.kind !== parsed.data.kind) return { ok: false, error: "wrong_kind" };
  if (due.kind === "FULL" && order.paymentStatus === "DISPUTED") return { ok: false, error: "conflict" };

  const statements: BatchStatement[] = [
    db.insert(paymentVerifications).values({ orderId, kind: due.kind, action: due.kind === "DEPOSIT" ? "REJECTED" : "DISPUTED", amount: due.amount, note: parsed.data.reason, adminId: actor.adminId, adminLabel: actor.label, createdAt: now }),
  ];
  const publicNote = parsed.data.publicNote || null;
  if (due.kind === "DEPOSIT" && order.status === "DEPOSIT_SUBMITTED") {
    statements.push(
      db
        .update(orders)
        .set({ status: "AWAITING_DEPOSIT", depositStatus: "AWAITING", depositMethod: null, depositReference: null, depositSubmittedAt: null })
        .where(and(eq(orders.id, orderId), eq(orders.status, "DEPOSIT_SUBMITTED"))),
      db.insert(orderStatusHistory).values({ orderId, fromStatus: "DEPOSIT_SUBMITTED", toStatus: "AWAITING_DEPOSIT", actorType: "ADMIN", actorId: actor.adminId, actorLabel: actor.label, publicNote, createdAt: now }),
    );
  } else if (due.kind === "FULL") {
    statements.push(db.update(orders).set({ paymentStatus: "DISPUTED" }).where(and(eq(orders.id, orderId), eq(orders.paymentStatus, "PENDING"))));
  }
  if (publicNote && !(due.kind === "DEPOSIT" && order.status === "DEPOSIT_SUBMITTED")) {
    // A message for the customer without a status change: same status in history.
    statements.push(db.insert(orderStatusHistory).values({ orderId, fromStatus: order.status, toStatus: order.status, actorType: "ADMIN", actorId: actor.adminId, actorLabel: actor.label, publicNote, createdAt: now }));
  }
  statements.push(
    auditInsert(db, actor, {
      action: due.kind === "DEPOSIT" ? "payment.deposit.rejected" : "payment.full.disputed",
      targetType: "order",
      targetId: orderId,
      metadata: { orderNumber: order.orderNumber, amount: due.amount, reason: parsed.data.reason },
    }),
  );
  await runBatch(db, statements);
  return { ok: true };
}

/**
 * Records a refund that staff ALREADY arranged outside the system (no money
 * moves here). FULL: PAID → REFUNDED, which also revokes downloads.
 * DEPOSIT: only for a cancelled order whose deposit was verified.
 */
export async function recordRefund(db: Database, orderId: string, raw: unknown, actor: Admin, now = new Date()): Promise<Result> {
  const parsed = refundSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: "not_found" };
  const kind = parsed.data.kind;
  const history = await db
    .select({ action: paymentVerifications.action, amount: paymentVerifications.amount })
    .from(paymentVerifications)
    .where(and(eq(paymentVerifications.orderId, orderId), eq(paymentVerifications.kind, kind)));
  if (history.some((h) => h.action === "REFUND_RECORDED")) return { ok: false, error: "not_refundable" };
  let amount: number;
  const statements: BatchStatement[] = [];
  if (kind === "FULL") {
    if (order.paymentStatus !== "PAID") return { ok: false, error: "not_refundable" };
    amount = history.find((h) => h.action === "CONFIRMED")?.amount ?? order.total - (order.depositStatus === "VERIFIED" ? order.depositAmount : 0);
    statements.push(db.update(orders).set({ paymentStatus: "REFUNDED" }).where(and(eq(orders.id, orderId), eq(orders.paymentStatus, "PAID"))));
  } else {
    if (order.depositStatus !== "VERIFIED" || order.status !== "CANCELLED") return { ok: false, error: "not_refundable" };
    amount = order.depositAmount;
  }
  statements.unshift(db.insert(paymentVerifications).values({ orderId, kind, action: "REFUND_RECORDED", amount, note: parsed.data.reason, adminId: actor.adminId, adminLabel: actor.label, createdAt: now }));
  statements.push(
    auditInsert(db, actor, { action: `payment.${kind === "DEPOSIT" ? "deposit" : "full"}.refund_recorded`, targetType: "order", targetId: orderId, metadata: { orderNumber: order.orderNumber, amount, reason: parsed.data.reason } }),
  );
  await runBatch(db, statements);
  return { ok: true };
}

export async function listVerificationsForOrder(db: Database, orderId: string) {
  return db.select().from(paymentVerifications).where(eq(paymentVerifications.orderId, orderId)).orderBy(desc(paymentVerifications.createdAt));
}

// ---------------------------------------------------------------------------
// Admin verification queue
// ---------------------------------------------------------------------------

export const paymentQueueSchema = z.object({
  view: z.enum(["awaiting", "disputed", "history", "refunded"]).catch("awaiting"),
  kind: z.enum(PAYMENT_VERIFICATION_KINDS).optional().catch(undefined),
  action: z.enum(PAYMENT_VERIFICATION_ACTIONS).optional().catch(undefined),
  q: z.string().trim().max(40).optional().catch(undefined),
  page: z.preprocess((v) => Number(v ?? 1), z.number().int().min(1).max(10_000)).catch(1),
});
export const PAYMENT_QUEUE_PAGE_SIZE = 25;
const OPEN = notInArray(orders.status, ["CANCELLED", "RETURNED"]);

/** Orders currently waiting for a payment decision (kind derived from the order row). */
function awaitingCondition(kind?: PaymentVerificationKind): SQL {
  const deposit = and(eq(orders.depositRequired, true), inArray(orders.depositStatus, ["AWAITING", "SUBMITTED"]), inArray(orders.status, ["AWAITING_DEPOSIT", "DEPOSIT_SUBMITTED"]))!;
  const full = and(eq(orders.paymentStatus, "PENDING"), or(eq(orders.depositRequired, false), eq(orders.depositStatus, "VERIFIED")))!;
  return and(OPEN, kind === "DEPOSIT" ? deposit : kind === "FULL" ? full : or(deposit, full))!;
}

export async function listPaymentQueue(db: Database, raw: Record<string, string | undefined>) {
  const query = paymentQueueSchema.parse(raw);
  const offset = (query.page - 1) * PAYMENT_QUEUE_PAGE_SIZE;
  const search = query.q ? sql`${orders.orderNumber} LIKE ${`%${escapeLike(query.q.toUpperCase())}%`} ESCAPE '\\'` : undefined;

  if (query.view === "history") {
    const where = and(query.kind ? eq(paymentVerifications.kind, query.kind) : undefined, query.action ? eq(paymentVerifications.action, query.action) : undefined, search);
    const [rows, total] = await Promise.all([
      db
        .select({
          id: paymentVerifications.id,
          orderId: orders.id,
          orderNumber: orders.orderNumber,
          kind: paymentVerifications.kind,
          action: paymentVerifications.action,
          amount: paymentVerifications.amount,
          currency: paymentVerifications.currency,
          channel: paymentVerifications.channel,
          note: paymentVerifications.note,
          adminLabel: paymentVerifications.adminLabel,
          adminName: adminUsers.displayName,
          createdAt: paymentVerifications.createdAt,
        })
        .from(paymentVerifications)
        .innerJoin(orders, eq(orders.id, paymentVerifications.orderId))
        .leftJoin(adminUsers, eq(adminUsers.id, paymentVerifications.adminId))
        .where(where)
        .orderBy(desc(paymentVerifications.createdAt))
        .limit(PAYMENT_QUEUE_PAGE_SIZE)
        .offset(offset),
      db.select({ n: sql<number>`COUNT(*)` }).from(paymentVerifications).innerJoin(orders, eq(orders.id, paymentVerifications.orderId)).where(where),
    ]);
    return { query, history: rows, orders: [], total: Number(total[0]?.n ?? 0) };
  }

  const where = and(
    query.view === "awaiting" ? awaitingCondition(query.kind) : query.view === "disputed" ? and(OPEN, eq(orders.paymentStatus, "DISPUTED")) : eq(orders.paymentStatus, "REFUNDED"),
    search,
  );
  const [rows, total] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        // Customer reference only: first name and the last 3 phone digits.
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        total: orders.total,
        currency: orders.currency,
        depositRequired: orders.depositRequired,
        depositAmount: orders.depositAmount,
        depositStatus: orders.depositStatus,
        hasDigital: orders.hasDigital,
        hasPhysical: orders.hasPhysical,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(PAYMENT_QUEUE_PAGE_SIZE)
      .offset(offset),
    db.$count(orders, where),
  ]);
  return {
    query,
    history: [],
    orders: rows.map(({ customerName, customerPhone, ...r }) => ({
      ...r,
      customerRef: `${customerName.split(/\s+/)[0]} · …${customerPhone.slice(-3)}`,
      due: paymentDue(r),
    })),
    total,
  };
}

/** Counts for the dashboard and the payments page tabs. */
export async function paymentQueueCounts(db: Database) {
  const [deposit, full, disputed] = await Promise.all([
    db.$count(orders, awaitingCondition("DEPOSIT")),
    db.$count(orders, awaitingCondition("FULL")),
    db.$count(orders, and(OPEN, eq(orders.paymentStatus, "DISPUTED"))),
  ]);
  return { awaitingDeposit: deposit, awaitingFull: full, disputed };
}
