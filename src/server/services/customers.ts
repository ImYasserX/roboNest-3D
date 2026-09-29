import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { qualified } from "@/server/db/sql";
import { runBatch, type BatchStatement, type Database } from "@/server/db/client";
import { addresses, orders, sessions, users } from "@/server/db/schema";
import { normalizeIraqiPhone } from "@/lib/phone";
import { escapeLike } from "@/lib/search-normalize";
import { auditInsert, type AuditActor } from "./audit";

export async function listCustomers(db: Database, raw: Record<string, string | undefined>) {
  const query = z
    .object({
      q: z.string().trim().max(60).optional().catch(undefined),
      page: z.preprocess((v) => Number(v ?? 1), z.number().int().min(1).max(10_000)).catch(1),
    })
    .parse(raw);
  const where: SQL[] = [];
  if (query.q) {
    const phone = normalizeIraqiPhone(query.q);
    where.push(phone ? eq(users.phone, phone) : or(like(users.name, `%${escapeLike(query.q)}%`))!);
  }
  const condition = where.length ? and(...where) : undefined;
  const pageSize = 25;
  const total = await db.$count(users, condition);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, pageCount);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      status: users.status,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      orderCount: sql<number>`(SELECT COUNT(*) FROM ${orders} WHERE ${qualified(orders.userId)} = ${qualified(users.id)})`,
      totalSpent: sql<number>`(SELECT COALESCE(SUM(${qualified(orders.total)}), 0) FROM ${orders} WHERE ${qualified(orders.userId)} = ${qualified(users.id)} AND ${qualified(orders.status)} = 'DELIVERED')`,
    })
    .from(users)
    .where(condition)
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageCount, query };
}

export async function getCustomer(db: Database, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [user] = await db
    .select({ id: users.id, name: users.name, phone: users.phone, status: users.status, locale: users.locale, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!user) return null;
  const [customerOrders, customerAddresses] = await Promise.all([
    db
      .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, total: orders.total, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.userId, id))
      .orderBy(desc(orders.createdAt))
      .limit(50),
    db.select().from(addresses).where(eq(addresses.userId, id)),
  ]);
  return { user, orders: customerOrders, addresses: customerAddresses };
}

export async function updateCustomer(db: Database, id: string, raw: unknown, actor: AuditActor) {
  const parsed = z
    .object({ name: z.string().trim().min(2).max(80), status: z.enum(["ACTIVE", "DISABLED"]) })
    .safeParse(raw);
  if (!parsed.success) return { ok: false as const };
  const [current] = await db.select({ name: users.name, status: users.status }).from(users).where(eq(users.id, id)).limit(1);
  if (!current) return { ok: false as const };
  const statements: BatchStatement[] = [
    db.update(users).set(parsed.data).where(eq(users.id, id)),
    auditInsert(db, actor, { action: "customer.updated", targetType: "customer", targetId: id, metadata: { from: current, to: parsed.data } }),
  ];
  if (parsed.data.status === "DISABLED") statements.push(db.delete(sessions).where(eq(sessions.userId, id)));
  await runBatch(db, statements);
  return { ok: true as const };
}

/** Super Admin only. Orders keep their snapshot (user_id is set to NULL). */
export async function deleteCustomer(db: Database, id: string, actor: AuditActor) {
  const [current] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, id)).limit(1);
  if (!current) return { ok: false as const };
  await runBatch(db, [
    db.delete(users).where(eq(users.id, id)),
    auditInsert(db, actor, { action: "customer.deleted", targetType: "customer", targetId: id }),
  ]);
  return { ok: true as const };
}
