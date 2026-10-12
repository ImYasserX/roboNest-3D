import type { DepositStatus, OrderStatus, PaymentStatus, PaymentVerificationKind } from "./domain";

// What a customer owes RoboNest.3D right now, derived ONLY from the order row.
// Shared by the order page (WhatsApp step), the admin verification queue and
// the server-side confirmation, so the amount shown, the amount in the
// WhatsApp message and the amount an admin can confirm are always the same.
//
//   1. A required 30% deposit that is not verified yet → DEPOSIT, deposit amount.
//   2. Otherwise, while payment is PENDING or DISPUTED → FULL, total minus a
//      verified deposit. (Physical-only orders usually pay this in cash on
//      delivery; orders with digital files pay it upfront via WhatsApp.)
//   3. Paid, refunded, cancelled or returned orders owe nothing.

export type PaymentDueInput = {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: number;
  depositRequired: boolean;
  depositAmount: number;
  depositStatus: DepositStatus;
  hasDigital: boolean;
  hasPhysical: boolean;
};

export type PaymentDue = {
  kind: PaymentVerificationKind;
  amount: number;
  /** Where the customer is expected to pay it. */
  channel: "WHATSAPP" | "ON_DELIVERY";
} | null;

const CLOSED: readonly OrderStatus[] = ["CANCELLED", "RETURNED"];

export function paymentDue(o: PaymentDueInput): PaymentDue {
  if (CLOSED.includes(o.status)) return null;
  if (o.depositRequired && o.depositStatus !== "VERIFIED") return { kind: "DEPOSIT", amount: o.depositAmount, channel: "WHATSAPP" };
  if (o.paymentStatus !== "PENDING" && o.paymentStatus !== "DISPUTED") return null;
  const amount = o.total - (o.depositRequired && o.depositStatus === "VERIFIED" ? o.depositAmount : 0);
  if (amount <= 0) return null;
  // Digital files are only released after payment, so they are paid upfront.
  return { kind: "FULL", amount, channel: o.hasDigital || !o.hasPhysical ? "WHATSAPP" : "ON_DELIVERY" };
}

/** Prefilled WhatsApp text: order reference and amount only (no personal data, links or tokens). */
export function paymentWhatsappText(locale: string, orderNumber: string, due: NonNullable<PaymentDue>): string {
  const amount = due.amount.toLocaleString("en-US");
  if (locale === "ar") {
    return due.kind === "DEPOSIT"
      ? `مرحباً RoboNest.3D، أريد تأكيد دفع العربون للطلب ${orderNumber}. المبلغ: ${amount} د.ع`
      : `مرحباً RoboNest.3D، أريد تأكيد الدفع للطلب ${orderNumber}. المبلغ: ${amount} د.ع`;
  }
  return due.kind === "DEPOSIT"
    ? `Hello RoboNest.3D, I would like to confirm the deposit for order ${orderNumber}. Amount: ${amount} IQD.`
    : `Hello RoboNest.3D, I would like to confirm payment for order ${orderNumber}. Amount: ${amount} IQD.`;
}
