"use server";

import { refresh } from "next/cache";
import { getCurrentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { scheduleNotifications } from "@/server/notify";
import { getRequestMeta } from "@/server/request-meta";
import { submitDeposit } from "@/server/services/deposits";
import { checkOnlineDeposit, latestOnlinePayment, startOnlineDeposit } from "@/server/services/online-deposits";
import { eventIdsForOrder } from "@/server/services/notifications";
import { getDepositProvider } from "@/server/payments";
import { getSiteUrl } from "@/server/env";
import { getOrderByAccessToken, getOrderForUser } from "@/server/services/orders";
import { consumeScoped } from "@/server/services/rate-limit";

export type DepositFormState = { ok?: boolean; error?: string } | null;

/** Customer reports a deposit transfer. Requires the order link token or ownership. */
export async function submitDepositAction(_prev: DepositFormState, formData: FormData): Promise<DepositFormState> {
  const orderNumber = String(formData.get("orderNumber") ?? "").slice(0, 40);
  const token = String(formData.get("token") ?? "").slice(0, 80);
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeScoped(db, "depositSubmit", "depositSubmit", orderNumber, ipHash))) return { error: "rate_limited" };
  const user = await getCurrentUser();
  const order = (token ? await getOrderByAccessToken(db, orderNumber, token) : null) ?? (user ? await getOrderForUser(db, orderNumber, user.id) : null);
  if (!order) return { error: "not_found" };
  const result = await submitDeposit(db, order.id, { method: formData.get("method"), reference: formData.get("reference") }, { userId: user?.id ?? null, label: order.customerName });
  if (!result.ok) return { error: result.error };
  scheduleNotifications([result.eventId]);
  refresh();
  return { ok: true };
}

/** Starts (or reuses) an online FIB payment for the deposit. Never marks anything paid. */
export async function startOnlineDepositAction(_prev: OnlineDepositState, formData: FormData): Promise<OnlineDepositState> {
  const order = await accessibleOrder(formData);
  if (!order) return { error: "not_found" };
  const provider = await getDepositProvider();
  if (!provider) return { error: "online_unavailable" };
  const db = await getDb();
  const res = await startOnlineDeposit(db, provider, order.id, { callbackUrl: `${await getSiteUrl()}/api/payments/fib/callback` });
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true };
}

/** "I paid, check now": asks the provider for the real status. */
export async function checkOnlineDepositAction(_prev: OnlineDepositState, formData: FormData): Promise<OnlineDepositState> {
  const order = await accessibleOrder(formData);
  if (!order) return { error: "not_found" };
  const provider = await getDepositProvider();
  if (!provider) return { error: "online_unavailable" };
  const db = await getDb();
  const latest = await latestOnlinePayment(db, order.id);
  if (!latest) return { error: "not_found" };
  const outcome = await checkOnlineDeposit(db, provider, { paymentId: latest.id });
  if (outcome === "verified") {
    const ids = await eventIdsForOrder(db, order.id);
    scheduleNotifications(ids);
  }
  refresh();
  return outcome === "verified" || outcome === "already_verified" ? { ok: true, outcome } : { error: outcome };
}

export type OnlineDepositState = { ok?: boolean; outcome?: string; error?: string } | null;

async function accessibleOrder(formData: FormData) {
  const orderNumber = String(formData.get("orderNumber") ?? "").slice(0, 40);
  const token = String(formData.get("token") ?? "").slice(0, 80);
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeScoped(db, "depositSubmit", "depositSubmit", orderNumber, ipHash))) return null;
  const user = await getCurrentUser();
  return (token ? await getOrderByAccessToken(db, orderNumber, token) : null) ?? (user ? await getOrderForUser(db, orderNumber, user.id) : null);
}
