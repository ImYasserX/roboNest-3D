import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { qualified } from "@/server/db/sql";
import { runBatch, type BatchStatement, type Database } from "@/server/db/client";
import {
  addresses,
  cartItems,
  deliveryAreas,
  deliveryZones,
  discounts,
  orderItems,
  orders,
  orderStatusHistory,
  products,
  uploads,
} from "@/server/db/schema";
import { hmacSha256Hex, sha256Hex, timingSafeEqual } from "@/server/auth/crypto";
import { normalizeIraqiPhone } from "@/lib/phone";
import { computeTotals, evaluateDiscount, resolveDeliveryFee, type DiscountErrorCode } from "@/lib/pricing";
import { depositBase, resolveDepositTerms, type DepositConfig } from "@/lib/payment-rules";
import type { OrderStatus } from "@/lib/domain";
import { getCartView, ownerKeyFor, type CartOwner } from "./cart";
import { orderPlacedEvent } from "./notifications";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max);
const noControl = (s: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);

export const checkoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  fullName: text(80).min(2).refine(noControl),
  phone: z.string().trim().max(24).transform((v, ctx) => {
    const phone = normalizeIraqiPhone(v);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return phone;
  }),
  zoneId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  areaId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  city: text(80).refine(noControl).optional(),
  district: text(80).refine(noControl).optional(),
  addressLine: text(200).refine(noControl).optional(),
  landmark: text(120).refine(noControl).optional(),
  deliveryNotes: text(300).refine(noControl).optional(),
  orderNotes: text(500).refine(noControl).optional(),
  discountCode: text(40).optional(),
  saveAddress: z.boolean().optional(),
  locale: z.enum(["ar", "en"]),
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

export type CheckoutError =
  | "invalid_input"
  | "cart_empty"
  | "cart_invalid"
  | "login_required_for_digital"
  | "address_required"
  | "zone_unavailable"
  | "area_unavailable"
  | "stock_changed"
  | "discount_exhausted"
  | "deposit_unconfigured"
  | `discount_${DiscountErrorCode}`
  | "failed";

// ---------------------------------------------------------------------------
// Tokens and numbers
// ---------------------------------------------------------------------------

/**
 * The order-tracking link token is derived (HMAC) from the order id so a
 * retried submit can return the same link. Only its hash is stored.
 */
export async function orderAccessToken(secret: string, orderId: string): Promise<string> {
  return (await hmacSha256Hex(secret, `order-access:${orderId}`)).slice(0, 40);
}

const ORDER_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I/L

export function generateOrderNumber(prefix = "RN", now = new Date()): string {
  const date = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const rand = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(rand, (b) => ORDER_ALPHABET[b % ORDER_ALPHABET.length]).join("");
  return `${prefix}-${date}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Pricing preview (cart + checkout pages)
// ---------------------------------------------------------------------------

export async function lookupDiscount(db: Database, code: string | undefined) {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(normalized)) return null;
  const [row] = await db.select().from(discounts).where(eq(discounts.code, normalized)).limit(1);
  return row ?? null;
}

export async function quoteDelivery(db: Database, zoneId: string | undefined, areaId: string | undefined) {
  if (!zoneId) return { ok: false as const, error: "address_required" as const };
  const [zone] = await db.select().from(deliveryZones).where(eq(deliveryZones.id, zoneId)).limit(1);
  const area = areaId ? (await db.select().from(deliveryAreas).where(eq(deliveryAreas.id, areaId)).limit(1))[0] : null;
  if (areaId && !area) return { ok: false as const, error: "area_unavailable" as const };
  const fee = resolveDeliveryFee(zone, area);
  return fee.ok ? { ok: true as const, fee: fee.fee, zone: zone!, area } : fee;
}

// ---------------------------------------------------------------------------
// Deposit terms (shared with custom-print quote acceptance)
// ---------------------------------------------------------------------------

/**
 * How a deposit can be paid. Since 2026-10-12 every payment is arranged with
 * RoboNest.3D on WhatsApp and confirmed by an Owner (owner decision), so a
 * deposit can always be paid; there is no automatic online provider.
 */
export const DEPOSIT_CONFIG: DepositConfig = { onlineAvailable: false, manualAvailable: true };

/** Initial status and deposit columns for a new order, or an error when a required deposit cannot be paid. */
export function initialPaymentState(totals: { subtotal: number; discountTotal: number; total: number }) {
  const terms = resolveDepositTerms(DEPOSIT_CONFIG, depositBase(totals.subtotal, totals.discountTotal));
  if ("error" in terms) return { ok: false as const, error: "deposit_unconfigured" as const };
  return {
    ok: true as const,
    status: (terms.required ? "AWAITING_DEPOSIT" : "PENDING") as OrderStatus,
    columns: {
      depositRequired: terms.required,
      depositAmount: terms.amount,
      depositStatus: terms.required ? ("AWAITING" as const) : ("NOT_REQUIRED" as const),
    },
  };
}

// ---------------------------------------------------------------------------
// Place order
// ---------------------------------------------------------------------------

export type PlaceOrderContext = {
  owner: CartOwner;
  userId: string | null;
  appSecret: string;
  now?: Date;
};

export type PlaceOrderResult =
  | { ok: true; orderId: string; orderNumber: string; accessToken: string; duplicate: boolean }
  | { ok: false; error: CheckoutError };

export async function placeOrder(db: Database, rawInput: unknown, ctx: PlaceOrderContext): Promise<PlaceOrderResult> {
  const parsed = checkoutSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const input = parsed.data;
  const now = ctx.now ?? new Date();
  const ownerKey = ownerKeyFor(ctx.owner);
  const idempotencyKey = await sha256Hex(`${ownerKey}|${input.idempotencyKey}`);

  // Duplicate submit (double click, retry, refresh): return the original order.
  const existing = await findByIdempotencyKey(db, idempotencyKey);
  if (existing) {
    return { ok: true, duplicate: true, orderId: existing.id, orderNumber: existing.orderNumber, accessToken: await orderAccessToken(ctx.appSecret, existing.id) };
  }

  const cart = await getCartView(db, ctx.owner);
  if (!cart.cartId || cart.lines.length === 0) return { ok: false, error: "cart_empty" };
  if (!cart.isValid) return { ok: false, error: "cart_invalid" };
  if (cart.hasDigital && !ctx.userId) return { ok: false, error: "login_required_for_digital" };

  let deliveryFee = 0;
  let address: {
    zoneId: string;
    governorateEn: string;
    governorateAr: string;
    city: string;
    district: string;
    addressLine: string;
    landmark: string | null;
    areaId: string | null;
  } | null = null;
  if (cart.hasPhysical) {
    if (!input.zoneId || !input.city || !input.district || !input.addressLine) return { ok: false, error: "address_required" };
    const quote = await quoteDelivery(db, input.zoneId, input.areaId);
    if (!quote.ok) return { ok: false, error: quote.error };
    deliveryFee = quote.fee;
    address = {
      zoneId: quote.zone.id,
      areaId: quote.area?.id ?? null,
      governorateEn: quote.zone.nameEn,
      governorateAr: quote.zone.nameAr,
      // A priced delivery area (when chosen) is the authoritative city/area name.
      city: quote.area ? (input.locale === "ar" ? quote.area.nameAr : quote.area.nameEn) : input.city,
      district: input.district,
      addressLine: input.addressLine,
      landmark: input.landmark || null,
    };
  }

  let discountAmount = 0;
  let discountRow: Awaited<ReturnType<typeof lookupDiscount>> = null;
  if (input.discountCode) {
    discountRow = await lookupDiscount(db, input.discountCode);
    const evaluated = evaluateDiscount(discountRow, cart.subtotal, now);
    if (!evaluated.ok) return { ok: false, error: `discount_${evaluated.error}` };
    discountAmount = evaluated.amount;
  }

  const totals = computeTotals(cart.lines.map((l) => l.lineTotal), discountAmount, deliveryFee);
  const payment = initialPaymentState(totals);
  if (!payment.ok) return { ok: false, error: payment.error };
  const orderId = crypto.randomUUID();
  const orderNumber = generateOrderNumber("RN", now);
  const accessToken = await orderAccessToken(ctx.appSecret, orderId);

  const statements: BatchStatement[] = [
    db.insert(orders).values({
      id: orderId,
      orderNumber,
      userId: ctx.userId,
      idempotencyKey,
      accessTokenHash: await sha256Hex(accessToken),
      customerName: input.fullName,
      customerPhone: input.phone,
      status: payment.status,
      paymentMethod: "COD",
      paymentStatus: "PENDING",
      currency: "IQD",
      ...totals,
      ...payment.columns,
      discountId: discountRow?.id ?? null,
      discountCode: discountRow?.code ?? null,
      hasPhysical: cart.hasPhysical,
      hasDigital: cart.hasDigital,
      deliveryZoneId: address?.zoneId ?? null,
      governorateEn: address?.governorateEn ?? null,
      governorateAr: address?.governorateAr ?? null,
      city: address?.city ?? null,
      district: address?.district ?? null,
      addressLine: address?.addressLine ?? null,
      landmark: address?.landmark ?? null,
      deliveryNotes: cart.hasPhysical ? input.deliveryNotes || null : null,
      orderNotes: input.orderNotes || null,
      locale: input.locale,
      createdAt: now,
      updatedAt: now,
    }),
    // One statement per line: D1 allows at most 100 bound parameters per query.
    ...cart.lines.map((l) =>
      db.insert(orderItems).values({
        orderId,
        productId: l.productId,
        productSlug: l.slug,
        productNameEn: l.nameEn,
        productNameAr: l.nameAr,
        productType: l.productType,
        imageKey: l.imageKey,
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
        options: l.snapshot,
        isPhysical: l.isPhysical,
        isDigital: l.isDigital,
        stockDeducted: l.trackStock,
      }),
    ),
    db.insert(orderStatusHistory).values({
      orderId,
      fromStatus: null,
      toStatus: payment.status,
      actorType: "CUSTOMER",
      actorId: ctx.userId,
      actorLabel: input.fullName,
      createdAt: now,
    }),
    // Outbox row in the same transaction: delivered after commit (server/notify.ts).
    orderPlacedEvent(db, {
      id: orderId,
      orderNumber,
      total: totals.total,
      deliveryFee: totals.deliveryFee,
      depositRequired: payment.columns.depositRequired,
      depositAmount: payment.columns.depositAmount,
      hasPhysical: cart.hasPhysical,
      hasDigital: cart.hasDigital,
      isCustomPrint: false,
    }, now),
    // Stock decrements: the products_stock_ck CHECK aborts the whole batch
    // if a concurrent order already took the last units.
    ...cart.lines
      .filter((l) => l.trackStock)
      .map((l) =>
        db
          .update(products)
          .set({ stockQuantity: sql`${products.stockQuantity} - ${l.quantity}` })
          .where(and(eq(products.id, l.productId), eq(products.availability, "IN_STOCK"))),
      ),
    ...(discountRow
      ? // discounts_uses_ck aborts the batch if the usage limit was reached concurrently.
        [db.update(discounts).set({ usedCount: sql`${discounts.usedCount} + 1` }).where(eq(discounts.id, discountRow.id))]
      : []),
    ...(cart.lines.some((l) => l.uploadIds.length > 0)
      ? [
          db
            .update(uploads)
            .set({ attachedType: "ORDER", attachedId: orderId })
            .where(
              and(
                inArray(uploads.id, cart.lines.flatMap((l) => l.uploadIds)),
                eq(uploads.ownerKey, ownerKey),
                isNull(uploads.attachedId),
              ),
            ),
        ]
      : []),
    db.delete(cartItems).where(eq(cartItems.cartId, cart.cartId)),
  ];

  if (input.saveAddress && ctx.userId && address) {
    statements.push(
      db.insert(addresses).values({
        userId: ctx.userId,
        fullName: input.fullName,
        phone: input.phone,
        zoneId: address.zoneId,
        areaId: address.areaId,
        city: address.city,
        district: input.district!,
        addressLine: address.addressLine,
        landmark: address.landmark,
      }),
    );
  }

  try {
    await runBatch(db, statements);
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (message.includes("orders.idempotency_key") || message.includes("orders_idempotency_uq")) {
      const winner = await findByIdempotencyKey(db, idempotencyKey);
      if (winner) {
        return { ok: true, duplicate: true, orderId: winner.id, orderNumber: winner.orderNumber, accessToken: await orderAccessToken(ctx.appSecret, winner.id) };
      }
    }
    if (message.includes("products_stock_ck")) return { ok: false, error: "stock_changed" };
    if (message.includes("discounts_uses_ck")) return { ok: false, error: "discount_exhausted" };
    console.error("placeOrder batch failed", { orderNumber, reason: message.slice(0, 200) });
    return { ok: false, error: "failed" };
  }

  return { ok: true, duplicate: false, orderId, orderNumber, accessToken };
}

async function findByIdempotencyKey(db: Database, key: string) {
  const [row] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(eq(orders.idempotencyKey, key))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Customer-side access
// ---------------------------------------------------------------------------

const ORDER_NUMBER = /^RN-\d{6}-[2-9A-HJKMNP-Z]{6}$/;

export function isOrderNumber(value: string) {
  return ORDER_NUMBER.test(value);
}

async function loadOrderDetail(db: Database, orderId: string) {
  const [items, history] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.createdAt)),
    db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId)).orderBy(asc(orderStatusHistory.createdAt)),
  ]);
  return { items, history };
}

export type CustomerOrderView = Awaited<ReturnType<typeof toCustomerView>>;

/** Strips internal fields (admin notes, cost, idempotency/token hashes, actor ids). */
async function toCustomerView(db: Database, order: typeof orders.$inferSelect) {
  const { items, history } = await loadOrderDetail(db, order.id);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    discountCode: order.discountCode,
    deliveryFee: order.deliveryFee,
    total: order.total,
    depositRequired: order.depositRequired,
    depositAmount: order.depositAmount,
    depositStatus: order.depositStatus,
    depositMethod: order.depositMethod,
    depositReference: order.depositReference,
    hasPhysical: order.hasPhysical,
    hasDigital: order.hasDigital,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    governorateEn: order.governorateEn,
    governorateAr: order.governorateAr,
    city: order.city,
    district: order.district,
    addressLine: order.addressLine,
    landmark: order.landmark,
    deliveryNotes: order.deliveryNotes,
    orderNotes: order.orderNotes,
    createdAt: order.createdAt,
    isOwnedByAccount: order.userId !== null,
    items: items.map((i) => ({
      id: i.id,
      productSlug: i.productSlug,
      productNameEn: i.productNameEn,
      productNameAr: i.productNameAr,
      imageKey: i.imageKey,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
      options: i.options.map((o) => ({ label: o.label, value: o.value, priceDelta: o.priceDelta })),
      isDigital: i.isDigital,
      productId: i.productId,
    })),
    history: history.map((h) => ({ toStatus: h.toStatus, publicNote: h.publicNote, createdAt: h.createdAt })),
  };
}

/** Signed-in customer: only their own orders. */
export async function getOrderForUser(db: Database, orderNumber: string, userId: string) {
  if (!isOrderNumber(orderNumber)) return null;
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderNumber, orderNumber), eq(orders.userId, userId)))
    .limit(1);
  return order ? toCustomerView(db, order) : null;
}

/** Guest link: order number + secret token from the confirmation URL. */
export async function getOrderByAccessToken(db: Database, orderNumber: string, token: string) {
  if (!isOrderNumber(orderNumber) || !/^[0-9a-f]{40}$/.test(token)) return null;
  const [order] = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
  if (!order) return null;
  if (!timingSafeEqual(await sha256Hex(token), order.accessTokenHash)) return null;
  return toCustomerView(db, order);
}

export async function listOrdersForUser(db: Database, userId: string, limit = 50) {
  return db
    .select({
      orderNumber: orders.orderNumber,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      total: orders.total,
      createdAt: orders.createdAt,
      itemCount: sql<number>`(SELECT SUM(${qualified(orderItems.quantity)}) FROM ${orderItems} WHERE ${qualified(orderItems.orderId)} = ${qualified(orders.id)})`,
    })
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}
