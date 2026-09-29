import { and, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { customPrintRequests, orderItems, orders, users } from "@/server/db/schema";
import { OPEN_STATUSES } from "@/lib/order-status";

// All figures are computed from orders in the database. Definitions:
//  - Goods revenue: subtotal − discount of DELIVERED orders (delivery fees are
//    passed through to the courier and reported separately).
//  - Booked value: totals of open orders not yet delivered.
//  - Gross profit: goods revenue − unit cost × qty for lines whose cost was
//    known at purchase time; `costCoverage` states how much revenue that covers.
// Dates are bucketed in Iraq time (UTC+3, no daylight saving).

export const PERIODS = [7, 30, 90, 365] as const;
export type Period = (typeof PERIODS)[number];

const IRAQ_DAY = (col: unknown) => sql<string>`date(${col} / 1000, 'unixepoch', '+3 hours')`;
const NOT_CANCELLED = notInArray(orders.status, ["CANCELLED", "RETURNED"]);

export async function getDashboard(db: Database, days: Period, opts: { includeProfit: boolean }) {
  const since = new Date(Date.now() - days * 86_400_000);
  const inPeriod = gte(orders.createdAt, since);
  const deliveredInPeriod = and(eq(orders.status, "DELIVERED"), gte(orders.deliveredAt, since));

  const [summary] = await db
    .select({
      orders: sql<number>`COUNT(*)`,
      cancelled: sql<number>`SUM(CASE WHEN ${orders.status} = 'CANCELLED' THEN 1 ELSE 0 END)`,
      pending: sql<number>`SUM(CASE WHEN ${orders.status} = 'PENDING' THEN 1 ELSE 0 END)`,
    })
    .from(orders)
    .where(inPeriod);

  const [delivered] = await db
    .select({
      count: sql<number>`COUNT(*)`,
      goodsRevenue: sql<number>`COALESCE(SUM(${orders.subtotal} - ${orders.discountTotal}), 0)`,
      deliveryFees: sql<number>`COALESCE(SUM(${orders.deliveryFee}), 0)`,
      discounts: sql<number>`COALESCE(SUM(${orders.discountTotal}), 0)`,
    })
    .from(orders)
    .where(deliveredInPeriod);

  const [open] = await db
    .select({ count: sql<number>`COUNT(*)`, value: sql<number>`COALESCE(SUM(${orders.total}), 0)` })
    .from(orders)
    .where(inArray(orders.status, [...OPEN_STATUSES]));
  const [pendingNow] = await db.select({ count: sql<number>`COUNT(*)` }).from(orders).where(eq(orders.status, "PENDING"));

  const revenueByDay = await db
    .select({ day: IRAQ_DAY(orders.deliveredAt), value: sql<number>`SUM(${orders.subtotal} - ${orders.discountTotal})` })
    .from(orders)
    .where(deliveredInPeriod)
    .groupBy(IRAQ_DAY(orders.deliveredAt));
  const ordersByDay = await db
    .select({ day: IRAQ_DAY(orders.createdAt), value: sql<number>`COUNT(*)` })
    .from(orders)
    .where(inPeriod)
    .groupBy(IRAQ_DAY(orders.createdAt));

  const topProducts = await db
    .select({
      productId: orderItems.productId,
      nameEn: sql<string>`MAX(${orderItems.productNameEn})`,
      nameAr: sql<string>`MAX(${orderItems.productNameAr})`,
      quantity: sql<number>`SUM(${orderItems.quantity})`,
      revenue: sql<number>`SUM(${orderItems.lineTotal})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(inPeriod, NOT_CANCELLED))
    .groupBy(orderItems.productId, orderItems.productSlug)
    .orderBy(desc(sql`SUM(${orderItems.lineTotal})`))
    .limit(8);

  const [digital] = await db
    .select({ quantity: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`, revenue: sql<number>`COALESCE(SUM(${orderItems.lineTotal}), 0)` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(inPeriod, eq(orderItems.isDigital, true), eq(orders.paymentStatus, "PAID")));

  const deliveryByZone = await db
    .select({
      governorateEn: orders.governorateEn,
      governorateAr: orders.governorateAr,
      orders: sql<number>`COUNT(*)`,
      delivered: sql<number>`SUM(CASE WHEN ${orders.status} = 'DELIVERED' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN ${orders.status} = 'FAILED_DELIVERY' THEN 1 ELSE 0 END)`,
      fees: sql<number>`COALESCE(SUM(${orders.deliveryFee}), 0)`,
    })
    .from(orders)
    .where(and(inPeriod, eq(orders.hasPhysical, true)))
    .groupBy(orders.governorateEn, orders.governorateAr)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(19);

  const [customers] = await db
    .select({ total: sql<number>`COUNT(*)`, newInPeriod: sql<number>`SUM(CASE WHEN ${users.createdAt} >= ${since.getTime()} THEN 1 ELSE 0 END)` })
    .from(users);
  const [repeat] = await db.all<{ repeatCustomers: number; uniqueCustomers: number }>(
    sql`SELECT SUM(CASE WHEN c > 1 THEN 1 ELSE 0 END) AS repeatCustomers, COUNT(*) AS uniqueCustomers FROM (SELECT ${orders.customerPhone}, COUNT(*) AS c FROM ${orders} WHERE ${orders.status} NOT IN ('CANCELLED') GROUP BY ${orders.customerPhone})`,
  );

  const customRequests = await db
    .select({ status: customPrintRequests.status, count: sql<number>`COUNT(*)` })
    .from(customPrintRequests)
    .where(gte(customPrintRequests.createdAt, since))
    .groupBy(customPrintRequests.status);

  let profit: { grossProfit: number; costedRevenue: number; costCoverage: number } | null = null;
  if (opts.includeProfit) {
    const [p] = await db
      .select({
        costedRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${orderItems.unitCost} IS NOT NULL THEN ${orderItems.lineTotal} ELSE 0 END), 0)`,
        cost: sql<number>`COALESCE(SUM(CASE WHEN ${orderItems.unitCost} IS NOT NULL THEN ${orderItems.unitCost} * ${orderItems.quantity} ELSE 0 END), 0)`,
        itemRevenue: sql<number>`COALESCE(SUM(${orderItems.lineTotal}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(deliveredInPeriod);
    // Discounts reduce profit; allocate them to costed lines proportionally.
    const discountShare = p.itemRevenue > 0 ? Math.round((delivered.discounts * p.costedRevenue) / p.itemRevenue) : 0;
    profit = {
      grossProfit: p.costedRevenue - discountShare - p.cost,
      costedRevenue: p.costedRevenue,
      costCoverage: p.itemRevenue > 0 ? p.costedRevenue / p.itemRevenue : 0,
    };
  }

  return {
    days,
    orders: Number(summary.orders ?? 0),
    cancelled: Number(summary.cancelled ?? 0),
    deliveredCount: Number(delivered.count ?? 0),
    goodsRevenue: Number(delivered.goodsRevenue ?? 0),
    deliveryFees: Number(delivered.deliveryFees ?? 0),
    averageOrderValue: delivered.count ? Math.round(Number(delivered.goodsRevenue) / Number(delivered.count)) : 0,
    openOrders: Number(open.count ?? 0),
    openValue: Number(open.value ?? 0),
    pendingNow: Number(pendingNow.count ?? 0),
    revenueSeries: fillDays(days, revenueByDay),
    orderSeries: fillDays(days, ordersByDay),
    topProducts,
    digital: { quantity: Number(digital.quantity), revenue: Number(digital.revenue) },
    deliveryByZone,
    customers: {
      registered: Number(customers.total ?? 0),
      newInPeriod: Number(customers.newInPeriod ?? 0),
      repeatCustomers: Number(repeat?.repeatCustomers ?? 0),
      uniqueCustomers: Number(repeat?.uniqueCustomers ?? 0),
    },
    customRequests: Object.fromEntries(customRequests.map((r) => [r.status, Number(r.count)])) as Record<string, number>,
    profit,
  };
}

function fillDays(days: number, rows: { day: string; value: number }[]) {
  const byDay = new Map(rows.map((r) => [r.day, Number(r.value)]));
  const out: { day: string; value: number }[] = [];
  const iraqNow = new Date(Date.now() + 3 * 3_600_000);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(iraqNow.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day: d, value: byDay.get(d) ?? 0 });
  }
  return out;
}
