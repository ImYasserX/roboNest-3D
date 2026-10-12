"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { getCurrentUser, getOwnerKey } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getAppSecret } from "@/server/env";
import { getRequestMeta } from "@/server/request-meta";
import { scheduleNotifications } from "@/server/notify";
import { eventIdsForOrder } from "@/server/services/notifications";
import { acceptQuote, declineQuote, getCustomRequestForCustomer, submitCustomRequest } from "@/server/services/custom-print";
import { consumeRateLimit, consumeScoped } from "@/server/services/rate-limit";

export async function submitCustomRequestAction(raw: Record<string, unknown>): Promise<{ ok: true; url: string } | { ok: false; error: string; fields?: string[] }> {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  const ownerKey = await getOwnerKey(false);
  if (!(await consumeScoped(db, "customRequest", "customRequestIp", ownerKey, ipHash))) return { ok: false, error: "rate_limited" };
  if (!ownerKey) return { ok: false, error: "invalid_upload", fields: ["files"] };
  const user = await getCurrentUser();
  const locale = await getLocale();
  const result = await submitCustomRequest(db, { ...raw, locale }, { ownerKey, userId: user?.id ?? null, appSecret: await getAppSecret() });
  if (!result.ok) return { ok: false, error: result.error, fields: result.fields };
  return { ok: true, url: `/${locale}/custom-printing/requests/${result.requestNumber}?t=${result.token}&new=1` };
}

const accessSchema = z.object({ requestNumber: z.string().max(40), token: z.string().max(64).nullable() });

async function authorizedRequest(raw: unknown) {
  const parsed = accessSchema.safeParse(raw);
  if (!parsed.success) return null;
  const user = await getCurrentUser();
  return getCustomRequestForCustomer(await getDb(), parsed.data.requestNumber, { userId: user?.id, token: parsed.data.token });
}

export async function acceptQuoteAction(access: { requestNumber: string; token: string | null }, address: Record<string, unknown>) {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "quoteResponse", ipHash))) return { ok: false as const, error: "rate_limited" };
  // The caller must hold the request link token or own the request.
  const request = await authorizedRequest(access);
  if (!request) return { ok: false as const, error: "not_found" };
  const result = await acceptQuote(db, request.id, address, { appSecret: await getAppSecret() });
  if (!result.ok) return { ok: false as const, error: result.error };
  scheduleNotifications(await eventIdsForOrder(db, result.orderId));
  return { ok: true as const, url: `/${await getLocale()}/orders/${result.orderNumber}?t=${result.accessToken}` };
}

export async function declineQuoteAction(access: { requestNumber: string; token: string | null }) {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "quoteResponse", ipHash))) return { ok: false as const, error: "rate_limited" };
  const request = await authorizedRequest(access);
  if (!request) return { ok: false as const, error: "not_found" };
  return declineQuote(db, request.id);
}
