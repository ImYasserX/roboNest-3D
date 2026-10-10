import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type Database } from "@/server/db/client";
import { customPrintRequests, orderItems, orders, orderStatusHistory, uploads } from "@/server/db/schema";
import { hmacSha256Hex, sha256Hex, timingSafeEqual } from "@/server/auth/crypto";
import { CUSTOM_REQUEST_STATUSES, MAX_PRICE_IQD, type CustomRequestStatus } from "@/lib/domain";
import { canAdminTransitionCustomRequest } from "@/lib/order-status";
import { normalizeIraqiPhone } from "@/lib/phone";
import { escapeLike } from "@/lib/search-normalize";
import { auditInsert, type AuditActor } from "./audit";
import { orderPlacedEvent } from "./notifications";
import { generateOrderNumber, initialPaymentState, orderAccessToken, quoteDelivery } from "./orders";
import { getSetting } from "./settings";

const noControl = (s: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);
const phoneField = z.string().trim().max(24).transform((v, ctx) => {
  const phone = normalizeIraqiPhone(v);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "invalid_phone" });
    return z.NEVER;
  }
  return phone;
});

export const customRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(80).refine(noControl),
  phone: phoneField,
  material: z.string().regex(/^[A-Z0-9_-]{2,20}$/),
  color: z.string().regex(/^[A-Z0-9_-]{2,20}$/),
  scalePercent: z.coerce.number().int().min(10).max(500),
  quantity: z.coerce.number().int().min(1).max(100),
  notes: z.string().trim().max(2000).refine(noControl).default(""),
  uploadIds: z.array(z.string().uuid()).min(1).max(5),
  locale: z.enum(["ar", "en"]),
});

export async function customRequestToken(secret: string, requestId: string) {
  return (await hmacSha256Hex(secret, `custom-request:${requestId}`)).slice(0, 40);
}

export async function submitCustomRequest(
  db: Database,
  raw: unknown,
  ctx: { ownerKey: string; userId: string | null; appSecret: string },
) {
  const parsed = customRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" as const, fields: parsed.error.issues.map((i) => String(i.path[0])) };
  const input = parsed.data;

  // Material and colour must be ones the workshop currently offers.
  const offer = await getSetting(db, "customPrint");
  if (!offer.materials.some((m) => m.code === input.material) || !offer.colors.some((c) => c.code === input.color)) {
    return { ok: false as const, error: "invalid_input" as const, fields: ["material"] };
  }

  const uniqueIds = [...new Set(input.uploadIds)];
  const owned = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(and(inArray(uploads.id, uniqueIds), eq(uploads.ownerKey, ctx.ownerKey), eq(uploads.purpose, "CUSTOM_PRINT"), isNull(uploads.attachedId)));
  if (owned.length !== uniqueIds.length) return { ok: false as const, error: "invalid_upload" as const, fields: ["files"] };

  const id = crypto.randomUUID();
  const requestNumber = generateOrderNumber("CP");
  const token = await customRequestToken(ctx.appSecret, id);
  await runBatch(db, [
    db.insert(customPrintRequests).values({
      id,
      requestNumber,
      userId: ctx.userId,
      accessTokenHash: await sha256Hex(token),
      customerName: input.fullName,
      customerPhone: input.phone,
      material: input.material,
      color: input.color,
      scalePercent: input.scalePercent,
      quantity: input.quantity,
      notes: input.notes,
      locale: input.locale,
    }),
    db
      .update(uploads)
      .set({ attachedType: "CUSTOM_REQUEST", attachedId: id })
      .where(and(inArray(uploads.id, uniqueIds), eq(uploads.ownerKey, ctx.ownerKey), isNull(uploads.attachedId))),
  ]);
  return { ok: true as const, id, requestNumber, token };
}

const REQUEST_NUMBER = /^CP-\d{6}-[2-9A-HJKMNP-Z]{6}$/;

function customerView(row: typeof customPrintRequests.$inferSelect, files: { filename: string; sizeBytes: number }[]) {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    status: row.status,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    material: row.material,
    color: row.color,
    scalePercent: row.scalePercent,
    quantity: row.quantity,
    notes: row.notes,
    quotedPrice: row.status === "QUOTED" || row.status === "ACCEPTED" || row.status === "DECLINED" ? row.quotedPrice : null,
    productionDays: row.productionDays,
    customerMessage: row.customerMessage,
    orderId: row.orderId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    files,
  };
}

async function filesFor(db: Database, requestId: string) {
  return db
    .select({ id: uploads.id, filename: uploads.filename, sizeBytes: uploads.sizeBytes })
    .from(uploads)
    .where(and(eq(uploads.attachedType, "CUSTOM_REQUEST"), eq(uploads.attachedId, requestId)))
    .orderBy(asc(uploads.createdAt));
}

export async function getCustomRequestForCustomer(
  db: Database,
  requestNumber: string,
  auth: { userId?: string | null; token?: string | null },
) {
  if (!REQUEST_NUMBER.test(requestNumber)) return null;
  const [row] = await db.select().from(customPrintRequests).where(eq(customPrintRequests.requestNumber, requestNumber)).limit(1);
  if (!row) return null;
  const byUser = Boolean(auth.userId && row.userId === auth.userId);
  const byToken = Boolean(auth.token && /^[0-9a-f]{40}$/.test(auth.token) && timingSafeEqual(await sha256Hex(auth.token), row.accessTokenHash));
  if (!byUser && !byToken) return null;
  const files = await filesFor(db, row.id);
  return customerView(row, files.map(({ filename, sizeBytes }) => ({ filename, sizeBytes })));
}

export async function listCustomRequestsForUser(db: Database, userId: string) {
  return db
    .select({
      requestNumber: customPrintRequests.requestNumber,
      status: customPrintRequests.status,
      material: customPrintRequests.material,
      quantity: customPrintRequests.quantity,
      quotedPrice: customPrintRequests.quotedPrice,
      createdAt: customPrintRequests.createdAt,
    })
    .from(customPrintRequests)
    .where(eq(customPrintRequests.userId, userId))
    .orderBy(desc(customPrintRequests.createdAt))
    .limit(50);
}

// ---------------------------------------------------------------------------
// Customer response to a quote
// ---------------------------------------------------------------------------

const acceptSchema = z.object({
  zoneId: z.string().uuid(),
  areaId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  city: z.string().trim().min(1).max(80).refine(noControl),
  district: z.string().trim().min(1).max(80).refine(noControl),
  addressLine: z.string().trim().min(3).max(200).refine(noControl),
  landmark: z.string().trim().max(120).refine(noControl).optional(),
  deliveryNotes: z.string().trim().max(300).refine(noControl).optional(),
});

/**
 * Accepting a quote converts the request into a real COD order priced at the
 * quoted amount plus the configured delivery fee. Idempotent per request.
 */
export async function acceptQuote(
  db: Database,
  requestId: string,
  raw: unknown,
  ctx: { appSecret: string; onlineDepositAvailable?: boolean },
) {
  const parsed = acceptSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" as const };
  const [request] = await db.select().from(customPrintRequests).where(eq(customPrintRequests.id, requestId)).limit(1);
  if (!request) return { ok: false as const, error: "not_found" as const };
  if (request.status === "ACCEPTED" && request.orderId) {
    const [o] = await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, request.orderId)).limit(1);
    return { ok: true as const, orderId: request.orderId, orderNumber: o.orderNumber, accessToken: await orderAccessToken(ctx.appSecret, request.orderId) };
  }
  if (request.status !== "QUOTED" || !request.quotedPrice) return { ok: false as const, error: "not_quoted" as const };

  const quote = await quoteDelivery(db, parsed.data.zoneId, parsed.data.areaId);
  if (!quote.ok) return { ok: false as const, error: quote.error };

  const subtotal = request.quotedPrice;
  const payment = await initialPaymentState(db, { subtotal, discountTotal: 0, total: subtotal + quote.fee }, ctx.onlineDepositAvailable ?? false);
  if (!payment.ok) return { ok: false as const, error: payment.error };
  const orderId = crypto.randomUUID();
  const orderNumber = generateOrderNumber("RN");
  const accessToken = await orderAccessToken(ctx.appSecret, orderId);
  const idempotencyKey = await sha256Hex(`custom-request|${request.id}`);
  try {
    // One atomic batch: the order is inserted first (the request row references
    // it), and the conditional update only succeeds while the quote is open.
    // A concurrent second acceptance fails on the order's unique idempotency key
    // and the whole batch rolls back.
    await runBatch(db, [
      db.insert(orders).values({
        id: orderId,
        orderNumber,
        userId: request.userId,
        idempotencyKey,
        accessTokenHash: await sha256Hex(accessToken),
        customerName: request.customerName,
        customerPhone: request.customerPhone,
        status: payment.status,
        paymentMethod: "COD",
        paymentStatus: "PENDING",
        ...payment.columns,
        subtotal,
        discountTotal: 0,
        deliveryFee: quote.fee,
        total: subtotal + quote.fee,
        hasPhysical: true,
        hasDigital: false,
        deliveryZoneId: quote.zone.id,
        governorateEn: quote.zone.nameEn,
        governorateAr: quote.zone.nameAr,
        city: quote.area ? (request.locale === "ar" ? quote.area.nameAr : quote.area.nameEn) : parsed.data.city,
        district: parsed.data.district,
        addressLine: parsed.data.addressLine,
        landmark: parsed.data.landmark || null,
        deliveryNotes: parsed.data.deliveryNotes || null,
        orderNotes: request.notes || null,
        locale: request.locale,
        customRequestId: request.id,
      }),
      db.insert(orderItems).values({
        orderId,
        productId: null,
        productSlug: "custom-print",
        productNameEn: `Custom print ${request.requestNumber}`,
        productNameAr: `طباعة حسب الطلب ${request.requestNumber}`,
        productType: "CUSTOM_SERVICE",
        unitPrice: subtotal,
        quantity: 1,
        lineTotal: subtotal,
        options: [
          { optionId: "material", label: { en: "Material", ar: "المادة" }, value: { en: request.material, ar: request.material }, priceDelta: 0 },
          { optionId: "color", label: { en: "Colour", ar: "اللون" }, value: { en: request.color, ar: request.color }, priceDelta: 0 },
          { optionId: "scale", label: { en: "Scale", ar: "الحجم" }, value: { en: `${request.scalePercent}%`, ar: `${request.scalePercent}%` }, priceDelta: 0 },
          { optionId: "pieces", label: { en: "Pieces", ar: "عدد القطع" }, value: { en: String(request.quantity), ar: String(request.quantity) }, priceDelta: 0 },
        ],
        isPhysical: true,
        isDigital: false,
      }),
      db.insert(orderStatusHistory).values({ orderId, toStatus: payment.status, actorType: "CUSTOMER", actorId: request.userId, actorLabel: request.customerName }),
      orderPlacedEvent(db, {
        id: orderId,
        orderNumber,
        total: subtotal + quote.fee,
        deliveryFee: quote.fee,
        depositRequired: payment.columns.depositRequired,
        depositAmount: payment.columns.depositAmount,
        hasPhysical: true,
        hasDigital: false,
        isCustomPrint: true,
      }),
      db
        .update(customPrintRequests)
        .set({ status: "ACCEPTED", orderId })
        .where(and(eq(customPrintRequests.id, requestId), eq(customPrintRequests.status, "QUOTED"))),
    ]);
  } catch (error) {
    const [existing] = await db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).limit(1);
    if (existing) return { ok: true as const, orderId: existing.id, orderNumber: existing.orderNumber, accessToken: await orderAccessToken(ctx.appSecret, existing.id) };
    console.error("acceptQuote failed", { requestId, reason: String(error).slice(0, 200) });
    return { ok: false as const, error: "failed" as const };
  }
  // The conditional update may have matched nothing (quote changed meanwhile).
  const [after] = await db.select({ orderId: customPrintRequests.orderId }).from(customPrintRequests).where(eq(customPrintRequests.id, requestId)).limit(1);
  if (after?.orderId !== orderId) {
    await db.delete(orders).where(eq(orders.id, orderId));
    return { ok: false as const, error: "not_quoted" as const };
  }
  return { ok: true as const, orderId, orderNumber, accessToken };
}

export async function declineQuote(db: Database, requestId: string) {
  const res = await db
    .update(customPrintRequests)
    .set({ status: "DECLINED" })
    .where(and(eq(customPrintRequests.id, requestId), eq(customPrintRequests.status, "QUOTED")))
    .returning({ id: customPrintRequests.id });
  return res.length === 1 ? { ok: true as const } : { ok: false as const, error: "not_quoted" as const };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function listCustomRequestsAdmin(db: Database, raw: Record<string, string | undefined>) {
  const query = z
    .object({
      q: z.string().trim().max(60).optional().catch(undefined),
      status: z.enum(CUSTOM_REQUEST_STATUSES).optional().catch(undefined),
      page: z.preprocess((v) => Number(v ?? 1), z.number().int().min(1).max(10_000)).catch(1),
    })
    .parse(raw);
  const where: SQL[] = [];
  if (query.status) where.push(eq(customPrintRequests.status, query.status));
  if (query.q) {
    const phone = normalizeIraqiPhone(query.q);
    const pattern = `%${escapeLike(query.q)}%`;
    where.push(
      phone
        ? eq(customPrintRequests.customerPhone, phone)
        : sql`(${customPrintRequests.requestNumber} LIKE ${pattern.toUpperCase()} ESCAPE '\\' OR ${customPrintRequests.customerName} LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  const condition = where.length ? and(...where) : undefined;
  const pageSize = 25;
  const total = await db.$count(customPrintRequests, condition);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, pageCount);
  const rows = await db
    .select({
      id: customPrintRequests.id,
      requestNumber: customPrintRequests.requestNumber,
      customerName: customPrintRequests.customerName,
      customerPhone: customPrintRequests.customerPhone,
      material: customPrintRequests.material,
      quantity: customPrintRequests.quantity,
      status: customPrintRequests.status,
      quotedPrice: customPrintRequests.quotedPrice,
      createdAt: customPrintRequests.createdAt,
    })
    .from(customPrintRequests)
    .where(condition)
    .orderBy(desc(customPrintRequests.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageCount, query };
}

export async function getCustomRequestAdmin(db: Database, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db.select().from(customPrintRequests).where(eq(customPrintRequests.id, id)).limit(1);
  if (!row) return null;
  const { accessTokenHash: _t, ...safe } = row;
  void _t;
  return { request: safe, files: await filesFor(db, id) };
}

export const reviewSchema = z.object({
  status: z.enum(CUSTOM_REQUEST_STATUSES),
  quotedPrice: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).max(MAX_PRICE_IQD).nullable()),
  productionDays: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).max(120).nullable()),
  customerMessage: z.string().trim().max(1000).refine(noControl).optional(),
  adminNotes: z.string().trim().max(2000).optional(),
});

export async function reviewCustomRequest(db: Database, id: string, raw: unknown, actor: AuditActor & { adminId: string }) {
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" as const };
  const input = parsed.data;
  const [row] = await db.select().from(customPrintRequests).where(eq(customPrintRequests.id, id)).limit(1);
  if (!row) return { ok: false as const, error: "not_found" as const };
  const statusChanged = input.status !== row.status;
  if (statusChanged && !canAdminTransitionCustomRequest(row.status, input.status as CustomRequestStatus)) {
    return { ok: false as const, error: "invalid_transition" as const };
  }
  if (input.status === "QUOTED" && (!input.quotedPrice || !input.productionDays)) {
    return { ok: false as const, error: "quote_incomplete" as const };
  }
  // Once accepted, the quote is part of an order and must not change.
  if (row.status === "ACCEPTED" && (input.quotedPrice !== row.quotedPrice || statusChanged)) {
    return { ok: false as const, error: "locked" as const };
  }
  const updated = await db
    .update(customPrintRequests)
    .set({
      status: input.status,
      quotedPrice: input.quotedPrice,
      productionDays: input.productionDays,
      customerMessage: input.customerMessage || null,
      adminNotes: input.adminNotes || null,
      reviewedBy: actor.adminId,
      reviewedAt: new Date(),
    })
    .where(and(eq(customPrintRequests.id, id), eq(customPrintRequests.status, row.status)))
    .returning({ id: customPrintRequests.id });
  if (updated.length !== 1) return { ok: false as const, error: "conflict" as const };
  await auditInsert(db, actor, {
    action: "customRequest.reviewed",
    targetType: "customRequest",
    targetId: id,
    metadata: { requestNumber: row.requestNumber, from: row.status, to: input.status, quotedPrice: input.quotedPrice },
  });
  return { ok: true as const };
}
