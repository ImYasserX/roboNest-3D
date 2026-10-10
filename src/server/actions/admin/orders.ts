"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { withAdmin } from "@/server/admin-action";
import { changeOrderStatus, changePaymentStatus, updateOrderAdminNotes } from "@/server/services/admin-orders";
import { rejectDeposit, verifyDeposit } from "@/server/services/deposits";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/domain";

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

export async function updatePaymentStatusAction(_prev: State, formData: FormData): Promise<State> {
  const parsed = z.object({ orderId: z.string().uuid(), paymentStatus: z.enum(PAYMENT_STATUSES) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "failed" };
  const res = await withAdmin("orders.update", ({ db, actor }) => changePaymentStatus(db, parsed.data.orderId, parsed.data.paymentStatus, actor));
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

const depositDecisionSchema = z.object({
  orderId: z.string().uuid(),
  decision: z.enum(["verify", "reject"]),
  publicNote: z.string().max(500).optional(),
  receivedAmount: z.string().max(20).optional(),
});

/** Records the staff decision on a reported deposit transfer (permission deposits.verify). */
export async function decideDepositAction(_prev: State, formData: FormData): Promise<State> {
  const parsed = depositDecisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "failed" };
  const { orderId, decision, publicNote } = parsed.data;
  const digits = (parsed.data.receivedAmount ?? "").replace(/[^\d]/g, "");
  const received = digits ? Number(digits) : undefined;
  const res = await withAdmin("deposits.verify", ({ db, actor }) =>
    decision === "verify" ? verifyDeposit(db, orderId, actor, publicNote, new Date(), received) : rejectDeposit(db, orderId, actor, publicNote),
  );
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true };
}
