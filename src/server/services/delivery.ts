import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type Database } from "@/server/db/client";
import { deliveryAreas, deliveryZones } from "@/server/db/schema";
import { MAX_PRICE_IQD } from "@/lib/domain";
import { auditInsert, type AuditActor } from "./audit";

export async function listDeliveryZones(db: Database, opts: { activeOnly?: boolean } = {}) {
  const zones = await db
    .select()
    .from(deliveryZones)
    .where(opts.activeOnly ? eq(deliveryZones.isActive, true) : undefined)
    .orderBy(asc(deliveryZones.sortOrder), asc(deliveryZones.nameEn));
  const areas = await db
    .select()
    .from(deliveryAreas)
    .where(opts.activeOnly ? eq(deliveryAreas.isActive, true) : undefined)
    .orderBy(asc(deliveryAreas.sortOrder), asc(deliveryAreas.nameEn));
  return zones.map((z) => ({ ...z, areas: areas.filter((a) => a.zoneId === z.id) }));
}

const fee = z.preprocess((v) => Number(v), z.number().int().min(0).max(MAX_PRICE_IQD));
const bool = z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean());

export const zoneSchema = z
  .object({
    fee,
    etaDaysMin: z.preprocess((v) => Number(v), z.number().int().min(0).max(30)),
    etaDaysMax: z.preprocess((v) => Number(v), z.number().int().min(0).max(30)),
    isActive: bool,
  })
  .refine((v) => v.etaDaysMin <= v.etaDaysMax, { path: ["etaDaysMax"], message: "range_invalid" });

export async function updateZone(db: Database, id: string, raw: unknown, actor: AuditActor) {
  const parsed = zoneSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const };
  const [zone] = await db.select().from(deliveryZones).where(eq(deliveryZones.id, id)).limit(1);
  if (!zone) return { ok: false as const };
  await runBatch(db, [
    db.update(deliveryZones).set(parsed.data).where(eq(deliveryZones.id, id)),
    auditInsert(db, actor, {
      action: "delivery.zone.updated",
      targetType: "deliveryZone",
      targetId: id,
      metadata: { code: zone.code, from: { fee: zone.fee, isActive: zone.isActive }, to: { fee: parsed.data.fee, isActive: parsed.data.isActive } },
    }),
  ]);
  return { ok: true as const };
}

export const areaSchema = z.object({
  nameEn: z.string().trim().min(2).max(60),
  nameAr: z.string().trim().min(2).max(60),
  fee,
  isActive: bool,
});

export async function saveArea(db: Database, zoneId: string, areaId: string | null, raw: unknown, actor: AuditActor) {
  const parsed = areaSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" };
  try {
    if (areaId) {
      const res = await db.update(deliveryAreas).set(parsed.data).where(eq(deliveryAreas.id, areaId)).returning({ zoneId: deliveryAreas.zoneId });
      if (res[0]?.zoneId !== zoneId) return { ok: false as const, error: "not_found" };
    } else {
      await db.insert(deliveryAreas).values({ zoneId, ...parsed.data });
    }
  } catch {
    return { ok: false as const, error: "duplicate" };
  }
  await auditInsert(db, actor, { action: areaId ? "delivery.area.updated" : "delivery.area.created", targetType: "deliveryZone", targetId: zoneId, metadata: { name: parsed.data.nameEn, fee: parsed.data.fee } });
  return { ok: true as const };
}

export async function deleteArea(db: Database, zoneId: string, areaId: string, actor: AuditActor) {
  const [area] = await db.select().from(deliveryAreas).where(eq(deliveryAreas.id, areaId)).limit(1);
  if (!area || area.zoneId !== zoneId) return { ok: false as const };
  await runBatch(db, [
    db.delete(deliveryAreas).where(eq(deliveryAreas.id, areaId)),
    auditInsert(db, actor, { action: "delivery.area.deleted", targetType: "deliveryZone", targetId: zoneId, metadata: { name: area.nameEn } }),
  ]);
  return { ok: true as const };
}
