import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type Database } from "@/server/db/client";
import { orders, orderStatusHistory } from "@/server/db/schema";
import { DEPOSIT_METHODS, type OrderStatus } from "@/lib/domain";
import { depositAmountFor, depositBase } from "@/lib/payment-rules";
import { auditInsert, type AuditActor } from "./audit";
import { depositSubmittedEvent } from "./notifications";
import { getSetting } from "./settings";

// Manual deposit workflow. No FIB, QiCard or ZainCash API is integrated, so a
// customer can only REPORT a transfer (method + transaction reference). The
// deposit counts as paid only after an authorized administrator checked the
// provider account and pressed "verify" (permission deposits.verify).

const noControl = (s: string) => !/[\u0000-\u001F\u007F]/.test(s);

export const depositSubmissionSchema = z.object({
  method: z.enum(DEPOSIT_METHODS),
  reference: z.string().trim().min(4).max(64).refine(noControl).refine((s) => /^[\p{L}\p{N}\s#._:/-]+$/u.test(s), "invalid_reference"),
});

export type DepositError = "not_found" | "invalid_input" | "method_unavailable" | "manual_not_approved" | "not_awaiting" | "conflict" | "amount_mismatch" | "failed";

/** Customer reports a transfer. Moves AWAITING_DEPOSIT → DEPOSIT_SUBMITTED; never marks anything paid. */
export async function submitDeposit(db: Database, orderId: string, raw: unknown, actor: { userId: string | null; label: string }, now = new Date()): Promise<{ ok: true; eventId: string } | { ok: false; error: DepositError }> {
  const parsed = depositSubmissionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const payments = await getSetting(db, "payments");
  // Manual reports are only accepted while the owners approve the fallback.
  if (!payments.manualFallback.approved) return { ok: false, error: "manual_not_approved" };
  if (!payments.methods[parsed.data.method].enabled) return { ok: false, error: "method_unavailable" };
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, error: "not_found" };
  if (!order.depositRequired || order.status !== "AWAITING_DEPOSIT") return { ok: false, error: "not_awaiting" };

  const claimed = await db
    .update(orders)
    .set({ status: "DEPOSIT_SUBMITTED", depositStatus: "SUBMITTED", depositMethod: parsed.data.method, depositReference: parsed.data.reference, depositSubmittedAt: now })
    .where(and(eq(orders.id, orderId), eq(orders.status, "AWAITING_DEPOSIT")))
    .returning({ id: orders.id });
  if (claimed.length !== 1) return { ok: false, error: "conflict" };

  const [{ n }] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(orderStatusHistory)
    .where(and(eq(orderStatusHistory.orderId, orderId), eq(orderStatusHistory.toStatus, "DEPOSIT_SUBMITTED")));
  const eventId = crypto.randomUUID();
  try {
    await runBatch(db, [
      db.insert(orderStatusHistory).values({ orderId, fromStatus: "AWAITING_DEPOSIT", toStatus: "DEPOSIT_SUBMITTED", actorType: "CUSTOMER", actorId: actor.userId, actorLabel: actor.label, createdAt: now }),
      depositSubmittedEvent(db, { id: orderId, orderNumber: order.orderNumber, total: order.total, depositAmount: order.depositAmount, method: parsed.data.method }, Number(n) + 1, now, eventId),
    ]);
  } catch (error) {
    await db.update(orders).set({ status: "AWAITING_DEPOSIT", depositStatus: "AWAITING", depositMethod: null, depositReference: null, depositSubmittedAt: null }).where(eq(orders.id, orderId));
    console.error("submitDeposit side effects failed", { orderId, reason: String(error).slice(0, 200) });
    return { ok: false, error: "failed" };
  }
  return { ok: true, eventId };
}

/**
 * Admin confirms the transfer arrived. DEPOSIT_SUBMITTED → DEPOSIT_VERIFIED.
 * The admin must type the amount actually seen in the provider account; it
 * has to equal the required 30% deposit exactly.
 */
export async function verifyDeposit(db: Database, orderId: string, actor: AuditActor & { adminId: string }, publicNote?: string, now = new Date(), receivedAmount?: number) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false as const, error: "not_found" as const };
  const expected = depositAmountFor(depositBase(order.subtotal, order.discountTotal));
  if (receivedAmount === undefined || !Number.isInteger(receivedAmount) || receivedAmount !== order.depositAmount || order.depositAmount !== expected) {
    return { ok: false as const, error: "amount_mismatch" as const };
  }
  return decideDeposit(db, orderId, "verify", actor, publicNote, now);
}

/** Admin could not find the transfer. DEPOSIT_SUBMITTED → AWAITING_DEPOSIT, with a note to the customer. */
export async function rejectDeposit(db: Database, orderId: string, actor: AuditActor & { adminId: string }, publicNote?: string, now = new Date()) {
  return decideDeposit(db, orderId, "reject", actor, publicNote, now);
}

async function decideDeposit(db: Database, orderId: string, decision: "verify" | "reject", actor: AuditActor & { adminId: string }, publicNote: string | undefined, now: Date): Promise<{ ok: true } | { ok: false; error: DepositError }> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, error: "not_found" };
  if (order.status !== "DEPOSIT_SUBMITTED" || order.depositStatus !== "SUBMITTED") return { ok: false, error: "not_awaiting" };
  const to: OrderStatus = decision === "verify" ? "DEPOSIT_VERIFIED" : "AWAITING_DEPOSIT";
  const patch: Partial<typeof orders.$inferInsert> =
    decision === "verify"
      ? { status: to, depositStatus: "VERIFIED" as const, depositVerifiedAt: now, depositVerifiedBy: actor.adminId }
      : { status: to, depositStatus: "AWAITING" as const, depositMethod: null, depositReference: null, depositSubmittedAt: null };
  const claimed = await db
    .update(orders)
    .set(patch)
    .where(and(eq(orders.id, orderId), eq(orders.status, "DEPOSIT_SUBMITTED")))
    .returning({ id: orders.id });
  if (claimed.length !== 1) return { ok: false, error: "conflict" };
  const note = publicNote?.trim().slice(0, 500) || null;
  await runBatch(db, [
    db.insert(orderStatusHistory).values({ orderId, fromStatus: "DEPOSIT_SUBMITTED", toStatus: to, actorType: "ADMIN", actorId: actor.adminId, actorLabel: actor.label, publicNote: note, createdAt: now }),
    auditInsert(db, actor, {
      action: decision === "verify" ? "order.deposit.verified" : "order.deposit.rejected",
      targetType: "order",
      targetId: orderId,
      metadata: { orderNumber: order.orderNumber, amount: order.depositAmount, method: order.depositMethod, reference: order.depositReference, channel: "manual" },
    }),
  ]);
  return { ok: true };
}

/** Enabled transfer methods with their localized instructions, for the order page. */
export async function enabledDepositMethods(db: Database, locale: string) {
  const payments = await getSetting(db, "payments");
  if (!payments.manualFallback.approved) return [];
  return DEPOSIT_METHODS.filter((m) => payments.methods[m].enabled).map((m) => ({ code: m, instructions: locale === "ar" ? payments.methods[m].instructions.ar : payments.methods[m].instructions.en }));
}
