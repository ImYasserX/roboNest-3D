"use server";

import { refresh } from "next/cache";
import { getLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current";
import { getCartOwner } from "@/server/cart-owner";
import { getDb } from "@/server/db/client";
import { getAppSecret } from "@/server/env";
import { getRequestMeta } from "@/server/request-meta";
import { checkoutSchema, placeOrder } from "@/server/services/orders";
import { consumeScoped } from "@/server/services/rate-limit";
import { scheduleNotifications } from "@/server/notify";
import { eventIdsForOrder } from "@/server/services/notifications";

export type CheckoutActionResult =
  | { ok: true; url: string }
  | { ok: false; error: string; fields?: Record<string, string> };

export async function placeOrderAction(raw: Record<string, unknown>): Promise<CheckoutActionResult> {
  const locale = await getLocale();
  const input = { ...raw, locale };
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      fields[key] ??= issue.message === "invalid_phone" ? "invalid_phone" : "invalid_input";
    }
    return { ok: false, error: "invalid_input", fields };
  }

  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  const owner = await getCartOwner({ create: false });
  if (!owner) return { ok: false, error: "cart_empty" };
  const ownerKey = owner.userId ? `user:${owner.userId}` : `visitor:${owner.visitorHash}`;
  if (!(await consumeScoped(db, "checkout", "checkoutIp", ownerKey, ipHash))) return { ok: false, error: "rate_limited" };

  const user = await getCurrentUser();
  const result = await placeOrder(db, input, { owner, userId: user?.id ?? null, appSecret: await getAppSecret() });
  if (!result.ok) {
    const fields: Record<string, string> = {};
    if (result.error === "address_required") for (const f of ["zoneId", "city", "district", "addressLine"]) if (!raw[f]) fields[f] = "invalid_input";
    if (result.error.startsWith("discount_")) fields.discountCode = result.error;
    if (result.error === "zone_unavailable") fields.zoneId = result.error;
    if (result.error === "area_unavailable") fields.areaId = result.error;
    if (result.error === "deposit_unconfigured") console.warn("High-value order blocked: deposit amount or methods not configured (admin → Payments)");
    return { ok: false, error: result.error, fields };
  }
  // Telegram alert after the response; failures are recorded, never surfaced here.
  scheduleNotifications(await eventIdsForOrder(db, result.orderId));
  refresh(); // header cart count
  return { ok: true, url: `/${locale}/orders/${result.orderNumber}?t=${result.accessToken}&new=1` };
}
