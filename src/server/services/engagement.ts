import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db/client";
import { auditLogs, contactMessages, products, wishlistItems } from "@/server/db/schema";
import { normalizeIraqiPhone } from "@/lib/phone";
import { CONTACT_STATUSES } from "@/lib/domain";

// Wishlist -------------------------------------------------------------------

export async function toggleWishlist(db: Database, userId: string, productId: string) {
  const [product] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.status, "PUBLISHED"))).limit(1);
  if (!product) return { ok: false as const };
  const removed = await db
    .delete(wishlistItems)
    .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)))
    .returning({ productId: wishlistItems.productId });
  if (removed.length > 0) return { ok: true as const, saved: false };
  await db.insert(wishlistItems).values({ userId, productId }).onConflictDoNothing();
  return { ok: true as const, saved: true };
}

export async function wishlistProductIds(db: Database, userId: string) {
  const rows = await db
    .select({ productId: wishlistItems.productId })
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, userId))
    .orderBy(desc(wishlistItems.createdAt))
    .limit(200);
  return rows.map((r) => r.productId);
}

// Contact --------------------------------------------------------------------

const noControl = (s: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(80).refine(noControl),
  phone: z.string().trim().max(24).transform((v, ctx) => {
    const p = normalizeIraqiPhone(v);
    if (!p) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return p;
  }),
  subject: z.string().trim().min(2).max(120).refine(noControl),
  message: z.string().trim().min(10).max(3000).refine(noControl),
  locale: z.enum(["ar", "en"]),
});

export async function submitContactMessage(db: Database, raw: unknown) {
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, fields: parsed.error.issues.map((i) => String(i.path[0])) };
  await db.insert(contactMessages).values(parsed.data);
  return { ok: true as const };
}

export async function listContactMessages(db: Database, status?: string) {
  const s = z.enum(CONTACT_STATUSES).safeParse(status);
  return db
    .select()
    .from(contactMessages)
    .where(s.success ? eq(contactMessages.status, s.data) : undefined)
    .orderBy(desc(contactMessages.createdAt))
    .limit(100);
}

export async function setContactStatus(db: Database, id: string, status: string) {
  const s = z.enum(CONTACT_STATUSES).safeParse(status);
  if (!s.success) return { ok: false as const };
  await db.update(contactMessages).set({ status: s.data }).where(eq(contactMessages.id, id));
  return { ok: true as const };
}

// Audit log ------------------------------------------------------------------

export async function listAuditLogs(db: Database, raw: Record<string, string | undefined>) {
  const query = z
    .object({
      action: z.string().regex(/^[a-zA-Z.]{1,60}$/).optional().catch(undefined),
      page: z.preprocess((v) => Number(v ?? 1), z.number().int().min(1).max(10_000)).catch(1),
    })
    .parse(raw);
  const pageSize = 50;
  const rows = await db
    .select()
    .from(auditLogs)
    .where(query.action ? eq(auditLogs.action, query.action) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize + 1)
    .offset((query.page - 1) * pageSize);
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page: query.page, query };
}
