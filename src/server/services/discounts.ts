import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type Database } from "@/server/db/client";
import { discounts } from "@/server/db/schema";
import { DISCOUNT_TYPES, MAX_PRICE_IQD } from "@/lib/domain";
import { auditInsert, type AuditActor } from "./audit";

const optionalInt = (max: number) =>
  z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).max(max).nullable());
// <input type="datetime-local"> values carry no zone; staff enter Iraq time (UTC+3).
const optionalDate = z.preprocess((v) => {
  if (v === "" || v == null) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  return new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00+03:00` : s);
}, z.date().nullable());

export const discountSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, "invalid_code"),
    description: z.string().trim().max(200).default(""),
    type: z.enum(DISCOUNT_TYPES),
    value: z.preprocess((v) => Number(v), z.number().int().min(1).max(MAX_PRICE_IQD)),
    minSubtotal: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(MAX_PRICE_IQD)),
    maxDiscount: optionalInt(MAX_PRICE_IQD),
    maxUses: optionalInt(1_000_000),
    startsAt: optionalDate,
    endsAt: optionalDate,
    isActive: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()),
  })
  .superRefine((v, ctx) => {
    if (v.type === "PERCENT" && v.value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "percent_range" });
    if (v.startsAt && v.endsAt && v.startsAt >= v.endsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "range_invalid" });
    if (Number.isNaN(v.startsAt?.getTime()) || Number.isNaN(v.endsAt?.getTime())) ctx.addIssue({ code: "custom", path: ["startsAt"], message: "invalid_date" });
  });

export async function listDiscounts(db: Database) {
  return db.select().from(discounts).orderBy(desc(discounts.createdAt)).limit(200);
}

export async function saveDiscount(db: Database, id: string | null, raw: unknown, actor: AuditActor) {
  const parsed = discountSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const [existing] = await db.select({ id: discounts.id }).from(discounts).where(eq(discounts.code, parsed.data.code)).limit(1);
  if (existing && existing.id !== id) return { ok: false as const, error: "code_taken" };
  const data = { ...parsed.data, maxDiscount: parsed.data.type === "PERCENT" ? parsed.data.maxDiscount : null };
  const targetId = id ?? crypto.randomUUID();
  try {
    await runBatch(db, [
      id ? db.update(discounts).set(data).where(eq(discounts.id, id)) : db.insert(discounts).values({ id: targetId, ...data }),
      auditInsert(db, actor, { action: id ? "discount.updated" : "discount.created", targetType: "discount", targetId, metadata: { code: data.code, type: data.type, value: data.value, isActive: data.isActive } }),
    ]);
  } catch {
    // e.g. lowering max uses below the current used count.
    return { ok: false as const, error: "invalid_input" };
  }
  return { ok: true as const };
}
