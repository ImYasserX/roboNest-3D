"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getAppSecret } from "@/server/env";
import { getRequestMeta } from "@/server/request-meta";
import { findOrderByNumberAndPhone, orderAccessToken } from "@/server/services/orders";
import { consumeRateLimit } from "@/server/services/rate-limit";

export async function trackOrderAction(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  const number = String(formData.get("orderNumber") ?? "").slice(0, 40);
  const phone = String(formData.get("phone") ?? "").slice(0, 30);
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  // Rate-limited so order numbers cannot be brute-forced against a phone.
  if (!(await consumeRateLimit(db, "orderLookup", ipHash))) return { error: "rate_limited" };
  const order = await findOrderByNumberAndPhone(db, number, phone);
  if (!order) return { error: "not_found" };
  const token = await orderAccessToken(await getAppSecret(), order.id);
  redirect(`/${await getLocale()}/orders/${order.orderNumber}?t=${token}`);
}
