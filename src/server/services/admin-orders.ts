import { and, asc, desc, eq, gt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type BatchStatement, type Database } from "@/server/db/client";
import { discounts, orderItems, orders, orderStatusHistory, products, uploads } from "@/server/db/schema";
import { ORDER_STATUSES, PAYMENT_STATUSES, type OrderStatus } from "@/lib/domain";
import { canTransitionOrder } from "@/lib/order-status";
import { normalizeIraqiPhone } from "@/lib/phone";
import { escapeLike } from "@/lib/search-normalize";
import { auditInsert, type AuditActor } from "./audit";

export const ADMIN_PAGE_SIZE = 25;

export const adminOrderQuerySchema = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  status: z.enum(ORDER_STATUSES).optional().catch(undefined),
  payment: z.enum(PAYMENT_STATUSES).optional().catch(undefined),
  sort: z.enum(["newest", "oldest", "total_desc", "total_asc"]).optional().catch(undefined),
  page: z.preprocess((v) => Number(v ?? 1), z.number().int().min(1).max(10_000)).catch(1),
});

export async function listOrdersAdmin(db: Database, raw: Record<string, string | undefined>) {
  const query = adminOrderQuerySchema.parse(raw);
  const where: SQL[] = [];
  if (query.status) where.push(eq(orders.status, query.status));
  if (query.payment) where.push(eq(orders.paymentStatus, query.payment));
  if (query.q) {
    const phone = normalizeIraqiPhone(query.q);
    const pattern = `%${escapeLike(query.q)}%`;
    where.push(
      or(
        sql`${orders.orderNumber} LIKE ${pattern.toUpperCase()} ESCAPE '\\'`,
        sql`${orders.customerName} LIKE ${pattern} ESCAPE '\\'`,
        phone ? eq(orders.customerPhone, phone) : sql`0`,
      )!,
    );
  }
  const condition = where.length ? and(...where) : undefined;
  const orderBy =
    query.sort === "oldest" ? asc(orders.createdAt) : query.sort === "total_desc" ? desc(orders.total) : query.sort === "total_asc" ? asc(orders.total) : desc(orders.createdAt);
  const total = await db.$count(orders, condition);
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      governorateEn: orders.governorateEn,
      governorateAr: orders.governorateAr,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      total: orders.total,
      hasDigital: orders.hasDigital,
      hasPhysical: orders.hasPhysical,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(condition)
    .orderBy(orderBy)
    .limit(ADMIN_PAGE_SIZE)
    .offset((page - 1) * ADMIN_PAGE_SIZE);
  return { rows, total, page, pageCount, query };
}

export async function getOrderAdmin(db: Database, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) return null;
  const [items, history, files] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.createdAt)),
    db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)).orderBy(asc(orderStatusHistory.createdAt)),
    db
      .select({ id: uploads.id, filename: uploads.filename, sizeBytes: uploads.sizeBytes })
      .from(uploads)
      .where(and(eq(uploads.attachedType, "ORDER"), eq(uploads.attachedId, id))),
  ]);
  // Never hand token/idempotency hashes to the admin UI either.
  const { accessTokenHash: _a, idempotencyKey: _i, ...safe } = order;
  void _a;
  void _i;
  return { order: safe, items, history, files };
}

export type StatusChangeError = "not_found" | "invalid_transition" | "conflict" | "failed";

/**
 * Moves an order to a new status. Uses a compare-and-set on the current
 * status so two admins cannot apply conflicting transitions, then records
 * history, audit, and side effects (restock on cancel/return). It never
 * changes the payment status.
 */
export async function changeOrderStatus(
  db: Database,
  orderId: string,
  input: { to: OrderStatus; expectedFrom: OrderStatus; publicNote?: string },
  actor: AuditActor,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: StatusChangeError }> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, error: "not_found" };
  if (order.status !== input.expectedFrom) return { ok: false, error: "conflict" };
  if (!canTransitionOrder(order.status, input.to, { hasPhysical: order.hasPhysical })) {
    return { ok: false, error: "invalid_transition" };
  }
  // Defence in depth (the orders_deposit_gate trigger enforces the same).
  if (order.depositRequired && order.depositStatus !== "VERIFIED" && input.to !== "CANCELLED") {
    return { ok: false, error: "invalid_transition" };
  }

  const patch: Partial<typeof orders.$inferInsert> = { status: input.to };
  if (input.to === "CONFIRMED" && !order.confirmedAt) patch.confirmedAt = now;
  // Delivery never marks the order paid: cash collected by the courier is
  // confirmed by an Owner in the payment verification workflow
  // (services/payment-verification.ts), like every other payment.
  if (input.to === "DELIVERED") patch.deliveredAt = now;
  if (input.to === "CANCELLED") patch.cancelledAt = now;

  const claimed = await db
    .update(orders)
    .set(patch)
    .where(and(eq(orders.id, orderId), eq(orders.status, input.expectedFrom)))
    .returning({ id: orders.id });
  if (claimed.length !== 1) return { ok: false, error: "conflict" };

  const note = input.publicNote?.trim().slice(0, 500) || null;
  const sideEffects: BatchStatement[] = [
    db.insert(orderStatusHistory).values({
      orderId,
      fromStatus: order.status,
      toStatus: input.to,
      actorType: "ADMIN",
      actorId: actor.adminId,
      actorLabel: actor.label,
      publicNote: note,
      createdAt: now,
    }),
    auditInsert(db, actor, {
      action: "order.status.changed",
      targetType: "order",
      targetId: orderId,
      metadata: { orderNumber: order.orderNumber, from: order.status, to: input.to },
    }),
  ];

  // Returning goods to stock: only lines whose checkout decremented stock.
  if (input.to === "CANCELLED" || input.to === "RETURNED") {
    const deducted = await db
      .select({ productId: orderItems.productId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), eq(orderItems.stockDeducted, true)));
    for (const item of deducted) {
      if (!item.productId) continue;
      sideEffects.push(
        db
          .update(products)
          .set({ stockQuantity: sql`COALESCE(${products.stockQuantity}, 0) + ${item.quantity}` })
          .where(and(eq(products.id, item.productId), eq(products.availability, "IN_STOCK"))),
      );
    }
    if (input.to === "CANCELLED" && order.discountId) {
      sideEffects.push(
        db.update(discounts).set({ usedCount: sql`${discounts.usedCount} - 1` }).where(and(eq(discounts.id, order.discountId), gt(discounts.usedCount, 0))),
      );
    }
  }

  try {
    await runBatch(db, sideEffects);
  } catch (error) {
    // Compensate so the order is not left in a state without history.
    await db.update(orders).set({ status: order.status, deliveredAt: order.deliveredAt, cancelledAt: order.cancelledAt, confirmedAt: order.confirmedAt }).where(eq(orders.id, orderId));
    console.error("changeOrderStatus side effects failed", { orderId, reason: String(error).slice(0, 200) });
    return { ok: false, error: "failed" };
  }
  return { ok: true };
}

export async function updateOrderAdminNotes(db: Database, orderId: string, notes: string, actor: AuditActor) {
  const value = notes.trim().slice(0, 2000) || null;
  await runBatch(db, [
    db.update(orders).set({ adminNotes: value }).where(eq(orders.id, orderId)),
    auditInsert(db, actor, { action: "order.notes.updated", targetType: "order", targetId: orderId }),
  ]);
  return { ok: true as const };
}

