import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { orders, previewModels, products } from "@/server/db/schema";
import { OPEN_STATUSES } from "@/lib/order-status";
import { paymentQueueCounts } from "./payment-verification";

/**
 * "What needs attention now" for the dashboard. Plain counts and sums read
 * from the database at request time; nothing is estimated or projected.
 */
export async function getOperationsOverview(db: Database) {
  const [byStatus, outstandingDeposits, payments, previewsPending, drafts] = await Promise.all([
    db
      .select({ status: orders.status, n: sql<number>`COUNT(*)` })
      .from(orders)
      .where(inArray(orders.status, [...OPEN_STATUSES]))
      .groupBy(orders.status),
    db
      .select({ n: sql<number>`COUNT(*)`, sum: sql<number>`COALESCE(SUM(${orders.depositAmount}), 0)` })
      .from(orders)
      .where(and(eq(orders.depositRequired, true), inArray(orders.depositStatus, ["AWAITING", "SUBMITTED"]), notInArray(orders.status, ["CANCELLED", "RETURNED"]))),
    paymentQueueCounts(db),
    db.$count(previewModels, eq(previewModels.status, "PENDING_REVIEW")),
    db.$count(products, eq(products.status, "DRAFT")),
  ]);
  return {
    openByStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.n) })),
    outstandingDeposits: { count: Number(outstandingDeposits[0]?.n ?? 0), amount: Number(outstandingDeposits[0]?.sum ?? 0) },
    payments,
    previewsPending,
    draftProducts: drafts,
  };
}
