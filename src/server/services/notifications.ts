import { and, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { notificationEvents } from "@/server/db/schema";
import { sendTelegramMessage } from "@/server/integrations/telegram";
import type { FetchLike } from "@/server/integrations/http";
import type { NotificationKind } from "@/lib/domain";
import { auditInsert, type AuditActor } from "./audit";

// Staff notification outbox. Events are inserted in the same D1 batch as the
// order (so a committed order always has one, and a failed order never does),
// then delivered after the response. Delivery failure never touches the order.
//
// Payloads hold only what staff need to triage: order number, amounts,
// deposit state, order type and an admin link. No customer name, phone,
// address, password, OTP or payment details.

export type NotifierConfig = { token: string; chatIds: string[]; siteUrl: string; invalidChatIds?: number };

export type OrderEventInput = {
  id: string;
  orderNumber: string;
  total: number;
  deliveryFee: number;
  depositRequired: boolean;
  depositAmount: number;
  hasPhysical: boolean;
  hasDigital: boolean;
  isCustomPrint: boolean;
};

const MAX_AUTO_ATTEMPTS = 8;
const LOCK_MS = 30_000;

export function orderPlacedEvent(db: Database, order: OrderEventInput, now = new Date()) {
  return db.insert(notificationEvents).values({
    kind: "ORDER_PLACED",
    dedupeKey: `ORDER_PLACED:${order.id}`,
    orderId: order.id,
    payload: {
      orderNumber: order.orderNumber,
      total: order.total,
      deliveryFee: order.deliveryFee,
      depositRequired: order.depositRequired,
      depositAmount: order.depositAmount,
      orderType: order.isCustomPrint ? "custom_print" : order.hasPhysical && order.hasDigital ? "physical_digital" : order.hasDigital ? "digital" : "physical",
    },
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

// DEPOSIT_SUBMITTED / DEPOSIT_PAID events came from the retired customer
// reference form and FIB adapter. No new ones are created; existing rows
// still render below.

const iqd = (n: unknown) => `${Number(n).toLocaleString("en-US")} IQD`;
const ORDER_TYPES: Record<string, string> = {
  physical: "Physical products",
  digital: "Digital files",
  physical_digital: "Physical products and digital files",
  custom_print: "Custom print (accepted quote)",
};

export function renderNotification(kind: NotificationKind, payload: Record<string, unknown>, orderId: string | null, siteUrl: string): string {
  const link = orderId ? `${siteUrl}/en/admin/orders/${orderId}` : null;
  if (kind === "TEST") return "RoboNest.3D test notification. Order alerts are configured correctly for this chat.";
  if (kind === "DEPOSIT_PAID") {
    return [
      `Deposit paid online for order ${payload.orderNumber}`,
      `Deposit: ${iqd(payload.depositAmount)} via ${payload.method}, confirmed by the provider's status check`,
      `Order value: ${iqd(payload.total)}`,
      "The order can now be confirmed.",
      link ? `Admin: ${link}` : "",
    ].filter(Boolean).join("\n");
  }
  if (kind === "DEPOSIT_SUBMITTED") {
    return [
      `Deposit submitted for order ${payload.orderNumber}`,
      `Deposit: ${iqd(payload.depositAmount)} via ${payload.method}`,
      `Order value: ${iqd(payload.total)}`,
      "Check the transfer in the provider account, then verify or reject it in the admin.",
      link ? `Admin: ${link}` : "",
    ].filter(Boolean).join("\n");
  }
  const deposit = payload.depositRequired
    ? `Deposit required: ${iqd(payload.depositAmount)} (30%), to be paid via WhatsApp. Do not start production before an owner has confirmed it in the admin.`
    : "No deposit required.";
  return [
    `New order ${payload.orderNumber}`,
    `Order value: ${iqd(payload.total)} (includes delivery ${iqd(payload.deliveryFee)})`,
    `Payment: manual (customer contacts us on WhatsApp; physical items can be paid on delivery). Nothing counts as paid until an owner confirms it. ${deposit}`,
    `Type: ${ORDER_TYPES[String(payload.orderType)] ?? String(payload.orderType)}`,
    link ? `Admin: ${link}` : "",
  ].filter(Boolean).join("\n");
}

export type DispatchOutcome = "sent" | "failed" | "not_configured" | "skipped";

/**
 * Delivers one event. A compare-and-set claim (status + lock) guarantees that
 * concurrent dispatchers never send the same event twice; recipients that
 * already received it are skipped on retries.
 */
export async function dispatchNotification(
  db: Database,
  eventId: string,
  config: NotifierConfig | null,
  opts: { fetchImpl?: FetchLike; now?: number; manual?: boolean } = {},
): Promise<DispatchOutcome> {
  const now = opts.now ?? Date.now();
  const [event] = await db
    .update(notificationEvents)
    .set({ status: "SENDING", lockedUntil: new Date(now + LOCK_MS), attempts: sql`${notificationEvents.attempts} + 1`, updatedAt: new Date(now) })
    .where(
      and(
        eq(notificationEvents.id, eventId),
        or(
          inArray(notificationEvents.status, ["PENDING", "FAILED", "NOT_CONFIGURED"]),
          and(eq(notificationEvents.status, "SENDING"), lt(notificationEvents.lockedUntil, new Date(now))),
        ),
        // Automatic runs only pick up due events; null means "manual retry only".
        opts.manual ? undefined : lte(notificationEvents.nextAttemptAt, new Date(now)),
      ),
    )
    .returning();
  if (!event) return "skipped";

  if (!config || config.chatIds.length === 0) {
    await db
      .update(notificationEvents)
      .set({ status: "NOT_CONFIGURED", lockedUntil: null, lastError: "Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_IDS)", nextAttemptAt: new Date(now + 15 * 60_000), updatedAt: new Date(now) })
      .where(eq(notificationEvents.id, eventId));
    return "not_configured";
  }

  const text = renderNotification(event.kind, event.payload, event.orderId, config.siteUrl);
  const delivered = new Set(event.deliveredTo);
  const errors: string[] = [];
  let retryable = false;
  for (const chatId of config.chatIds) {
    if (delivered.has(chatId)) continue;
    const res = await sendTelegramMessage(config.token, chatId, text, opts.fetchImpl);
    if (res.ok) {
      delivered.add(chatId);
      // Record each recipient immediately, so a crash before the loop ends can
      // never make a later retry message this owner a second time.
      await db
        .update(notificationEvents)
        .set({ deliveredTo: [...delivered], lockedUntil: new Date(Date.now() + LOCK_MS) })
        .where(eq(notificationEvents.id, eventId));
    } else {
      errors.push(`chat …${chatId.slice(-4)}: ${res.detail}`);
      retryable ||= res.retryable;
    }
  }
  const allSent = config.chatIds.every((c) => delivered.has(c));
  const attempts = event.attempts;
  const backoffMs = Math.min(2 ** attempts * 60_000, 6 * 60 * 60_000);
  await db
    .update(notificationEvents)
    .set({
      status: allSent ? "SENT" : "FAILED",
      deliveredTo: [...delivered],
      lockedUntil: null,
      lastError: allSent ? null : errors.join("; ").slice(0, 500),
      sentAt: allSent ? new Date(now) : null,
      // Permanent errors (bad chat id) wait for a manual retry after fixing config.
      nextAttemptAt: allSent || !retryable || attempts >= MAX_AUTO_ATTEMPTS ? null : new Date(now + backoffMs),
      updatedAt: new Date(now),
    })
    .where(eq(notificationEvents.id, eventId));
  if (!allSent) console.error("notification delivery failed", { eventId, kind: event.kind, attempts, retryable });
  return allSent ? "sent" : "failed";
}

/**
 * Marks events as SUPPRESSED (terminal, never retried automatically). Used
 * while OUTBOUND_INTEGRATIONS=disabled, so alerts about E2E/test orders can
 * never be delivered later once real credentials are present.
 */
export async function suppressNotifications(db: Database, eventIds: string[], now = Date.now()) {
  if (eventIds.length === 0) return;
  await db
    .update(notificationEvents)
    .set({ status: "SUPPRESSED", nextAttemptAt: null, lockedUntil: null, lastError: "Not sent: outbound integrations were disabled (OUTBOUND_INTEGRATIONS=disabled)", updatedAt: new Date(now) })
    .where(and(inArray(notificationEvents.id, eventIds), inArray(notificationEvents.status, ["PENDING", "NOT_CONFIGURED", "FAILED"])));
}

/** Delivers the given events, then a few overdue retries. Never throws. */
export async function dispatchPending(db: Database, config: NotifierConfig | null, eventIds: string[] = [], opts: { fetchImpl?: FetchLike; now?: number; limit?: number } = {}) {
  const now = opts.now ?? Date.now();
  try {
    for (const id of eventIds) await dispatchNotification(db, id, config, opts);
    const due = await db
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(
        and(
          inArray(notificationEvents.status, ["PENDING", "FAILED", "NOT_CONFIGURED", "SENDING"]),
          lte(notificationEvents.nextAttemptAt, new Date(now)),
          lt(notificationEvents.attempts, MAX_AUTO_ATTEMPTS),
        ),
      )
      .orderBy(notificationEvents.nextAttemptAt)
      .limit(opts.limit ?? 5);
    for (const row of due) if (!eventIds.includes(row.id)) await dispatchNotification(db, row.id, config, opts);
  } catch (error) {
    console.error("notification dispatch error", { reason: String((error as Error)?.message ?? error).slice(0, 200) });
  }
}

export async function eventIdsForOrder(db: Database, orderId: string) {
  const rows = await db.select({ id: notificationEvents.id }).from(notificationEvents).where(eq(notificationEvents.orderId, orderId));
  return rows.map((r) => r.id);
}

/** Admin "send test": a fixed message only; staff can never send arbitrary text. */
export async function createTestNotification(db: Database, actor: AuditActor) {
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(notificationEvents).values({ id, kind: "TEST", dedupeKey: `TEST:${id}`, payload: {}, nextAttemptAt: new Date() }),
    auditInsert(db, actor, { action: "notifications.test", targetType: "notification", targetId: id }),
  ]);
  return id;
}

export async function retryNotification(db: Database, id: string, config: NotifierConfig | null, actor: AuditActor, fetchImpl?: FetchLike) {
  const outcome = await dispatchNotification(db, id, config, { manual: true, fetchImpl });
  await auditInsert(db, actor, { action: "notifications.retry", targetType: "notification", targetId: id, metadata: { outcome } });
  return outcome;
}

export async function listNotificationEvents(db: Database, limit = 50) {
  return db
    .select({
      id: notificationEvents.id,
      kind: notificationEvents.kind,
      orderId: notificationEvents.orderId,
      payload: notificationEvents.payload,
      status: notificationEvents.status,
      attempts: notificationEvents.attempts,
      deliveredCount: sql<number>`json_array_length(${notificationEvents.deliveredTo})`,
      lastError: notificationEvents.lastError,
      sentAt: notificationEvents.sentAt,
      createdAt: notificationEvents.createdAt,
    })
    .from(notificationEvents)
    .orderBy(desc(notificationEvents.createdAt))
    .limit(limit);
}
