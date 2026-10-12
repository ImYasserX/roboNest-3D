"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { withAdmin } from "@/server/admin-action";
import { changeOrderStatus, updateOrderAdminNotes } from "@/server/services/admin-orders";
import { confirmPayment, disputePayment, recordRefund } from "@/server/services/payment-verification";
import { ORDER_STATUSES } from "@/lib/domain";

type State = { ok?: boolean; error?: string } | null;

const statusSchema = z.object({
  orderId: z.string().uuid(),
  to: z.enum(ORDER_STATUSES),
  expectedFrom: z.enum(ORDER_STATUSES),
  publicNote: z.string().max(500).optional(),
});

export async function updateOrderStatusAction(_prev: State, formData: FormData): Promise<State> {
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_transition" };
  const res = await withAdmin("orders.update", ({ db, actor }) =>
    changeOrderStatus(db, parsed.data.orderId, { to: parsed.data.to, expectedFrom: parsed.data.expectedFrom, publicNote: parsed.data.publicNote }, actor),
  );
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true };
}

export async function updateOrderNotesAction(_prev: State, formData: FormData): Promise<State> {
  const parsed = z.object({ orderId: z.string().uuid(), adminNotes: z.string().max(2000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "failed" };
  const res = await withAdmin("orders.update", ({ db, actor }) => updateOrderAdminNotes(db, parsed.data.orderId, parsed.data.adminNotes, actor));
  if (!res.ok) return { error: res.error };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Payment verification (Owner only: payments.verify). The form only says WHICH
// order and kind; amounts and state come from the database, and the admin's
// re-typed amount must match what is due.
// ---------------------------------------------------------------------------

const orderId = z.string().uuid();
const fields = (formData: FormData) => {
  const data: Record<string, unknown> = Object.fromEntries(formData);
  data.checked = formData.get("checked") === "on" ? true : undefined;
  return data;
};

export async function confirmPaymentAction(_prev: State, formData: FormData): Promise<State> {
  const id = orderId.safeParse(formData.get("orderId"));
  if (!id.success) return { error: "not_found" };
  const res = await withAdmin("payments.verify", ({ db, actor }) => confirmPayment(db, id.data, fields(formData), actor));
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true };
}

export async function disputePaymentAction(_prev: State, formData: FormData): Promise<State> {
  const id = orderId.safeParse(formData.get("orderId"));
  if (!id.success) return { error: "not_found" };
  const res = await withAdmin("payments.verify", ({ db, actor }) => disputePayment(db, id.data, fields(formData), actor));
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true };
}

export async function recordRefundAction(_prev: State, formData: FormData): Promise<State> {
  const id = orderId.safeParse(formData.get("orderId"));
  if (!id.success) return { error: "not_found" };
  const res = await withAdmin("payments.verify", ({ db, actor }) => recordRefund(db, id.data, fields(formData), actor));
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true };
}
