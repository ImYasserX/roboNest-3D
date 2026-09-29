import { and, asc, desc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { digitalFiles, orderItems, orders } from "@/server/db/schema";

// A purchased digital file is downloadable only when ALL hold:
//  - the order belongs to the signed-in customer (orders.user_id)
//  - the order is paid (COD collected / confirmed by staff)
//  - the order was not cancelled, returned, or refunded
//  - the file belongs to the purchased product and is active
//  - the per-item download cap has not been reached
// Files live in a private R2 bucket and are streamed by the download route;
// no public or guessable URL exists.

export const MAX_DOWNLOADS_PER_ITEM = 25;
const BLOCKED_STATUSES = ["CANCELLED", "RETURNED", "RETURN_REQUESTED"] as const;

export async function listEntitlements(db: Database, userId: string) {
  const items = await db
    .select({
      orderItemId: orderItems.id,
      productId: orderItems.productId,
      productNameEn: orderItems.productNameEn,
      productNameAr: orderItems.productNameAr,
      downloadCount: orderItems.downloadCount,
      orderNumber: orders.orderNumber,
      paymentStatus: orders.paymentStatus,
      status: orders.status,
      createdAt: orders.createdAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.userId, userId), eq(orderItems.isDigital, true), notInArray(orders.status, [...BLOCKED_STATUSES])))
    .orderBy(desc(orders.createdAt));

  const productIds = [...new Set(items.map((i) => i.productId).filter((id): id is string => Boolean(id)))];
  const files = productIds.length
    ? await db
        .select({ id: digitalFiles.id, productId: digitalFiles.productId, filename: digitalFiles.filename, format: digitalFiles.format, sizeBytes: digitalFiles.sizeBytes })
        .from(digitalFiles)
        .where(and(inArray(digitalFiles.productId, productIds), eq(digitalFiles.isActive, true)))
        .orderBy(asc(digitalFiles.createdAt))
    : [];

  return items.map((item) => ({
    ...item,
    unlocked: item.paymentStatus === "PAID",
    remaining: Math.max(0, MAX_DOWNLOADS_PER_ITEM - item.downloadCount),
    files: files.filter((f) => f.productId === item.productId),
  }));
}

export type DownloadDenied = "not_found" | "unpaid" | "limit_reached";

export async function authorizeDownload(
  db: Database,
  userId: string,
  orderItemId: string,
  fileId: string,
): Promise<{ ok: true; file: { r2Key: string; filename: string; sizeBytes: number } } | { ok: false; error: DownloadDenied }> {
  const uuid = /^[0-9a-f-]{36}$/;
  if (!uuid.test(orderItemId) || !uuid.test(fileId)) return { ok: false, error: "not_found" };

  const [row] = await db
    .select({
      productId: orderItems.productId,
      isDigital: orderItems.isDigital,
      downloadCount: orderItems.downloadCount,
      paymentStatus: orders.paymentStatus,
      status: orders.status,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.id, orderItemId), eq(orders.userId, userId)))
    .limit(1);
  // Same response whether the item does not exist or belongs to someone else.
  if (!row || !row.isDigital || !row.productId || (BLOCKED_STATUSES as readonly string[]).includes(row.status)) {
    return { ok: false, error: "not_found" };
  }
  if (row.paymentStatus !== "PAID") return { ok: false, error: "unpaid" };

  const [file] = await db
    .select({ r2Key: digitalFiles.r2Key, filename: digitalFiles.filename, sizeBytes: digitalFiles.sizeBytes })
    .from(digitalFiles)
    .where(and(eq(digitalFiles.id, fileId), eq(digitalFiles.productId, row.productId), eq(digitalFiles.isActive, true)))
    .limit(1);
  if (!file) return { ok: false, error: "not_found" };

  // Atomic increment that refuses to exceed the cap under concurrency.
  const counted = await db
    .update(orderItems)
    .set({ downloadCount: sql`${orderItems.downloadCount} + 1` })
    .where(and(eq(orderItems.id, orderItemId), lt(orderItems.downloadCount, MAX_DOWNLOADS_PER_ITEM)))
    .returning({ id: orderItems.id });
  if (counted.length !== 1) return { ok: false, error: "limit_reached" };
  return { ok: true, file };
}
