import type { CustomRequestStatus, OrderStatus } from "./domain";

// Order lifecycle for a made-to-order business with third-party delivery.
//
//   High-value orders (see lib/payment-rules.ts) start with a deposit stage:
//   AWAITING_DEPOSIT → DEPOSIT_SUBMITTED (customer sends a reference)
//     → DEPOSIT_VERIFIED (staff checked the transfer) → CONFIRMED
//   A rejected submission returns to AWAITING_DEPOSIT. The deposit steps are
//   NOT reachable through the generic admin status change: they have their
//   own server functions (services/deposits.ts), so nobody can skip a check.
//
//   PENDING → CONFIRMED → IN_PRODUCTION → QUALITY_CHECK → READY_FOR_DELIVERY
//     → OUT_FOR_DELIVERY → DELIVERED → (RETURN_REQUESTED → RETURNED)
//
// In-stock items can skip production (CONFIRMED → READY_FOR_DELIVERY).
// Digital-only orders go CONFIRMED → DELIVERED once payment is arranged.
// FAILED_DELIVERY can be retried, returned to the workshop, or cancelled.

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  AWAITING_DEPOSIT: ["CANCELLED"],
  DEPOSIT_SUBMITTED: ["CANCELLED"],
  DEPOSIT_VERIFIED: ["CONFIRMED", "CANCELLED"],
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PRODUCTION", "READY_FOR_DELIVERY", "DELIVERED", "CANCELLED"],
  IN_PRODUCTION: ["QUALITY_CHECK", "CANCELLED"],
  QUALITY_CHECK: ["IN_PRODUCTION", "READY_FOR_DELIVERY", "CANCELLED"],
  READY_FOR_DELIVERY: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED_DELIVERY"],
  FAILED_DELIVERY: ["OUT_FOR_DELIVERY", "RETURNED", "CANCELLED"],
  DELIVERED: ["RETURN_REQUESTED"],
  RETURN_REQUESTED: ["RETURNED", "DELIVERED"],
  RETURNED: [],
  CANCELLED: [],
};

export function allowedOrderTransitions(from: OrderStatus, ctx: { hasPhysical: boolean }): OrderStatus[] {
  return TRANSITIONS[from].filter((to) => {
    // Physical goods must go through the delivery pipeline before DELIVERED.
    if (from === "CONFIRMED" && to === "DELIVERED") return !ctx.hasPhysical;
    // Nothing to ship for digital-only orders.
    if (!ctx.hasPhysical && ["IN_PRODUCTION", "READY_FOR_DELIVERY"].includes(to)) return false;
    return true;
  });
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus, ctx: { hasPhysical: boolean }): boolean {
  return allowedOrderTransitions(from, ctx).includes(to);
}

/** Statuses an order passes through while its deposit is open. */
export const DEPOSIT_STAGE_STATUSES: readonly OrderStatus[] = ["AWAITING_DEPOSIT", "DEPOSIT_SUBMITTED", "DEPOSIT_VERIFIED"];

/** Customer-facing progress steps shown on the order page. */
export const ORDER_PROGRESS: readonly OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "QUALITY_CHECK",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ["DELIVERED", "RETURNED", "CANCELLED"];

/** Statuses that count as realised revenue in analytics. */
export const REVENUE_STATUSES: readonly OrderStatus[] = ["DELIVERED", "RETURN_REQUESTED"];
/** Statuses that count as open (booked, not yet realised). */
export const OPEN_STATUSES: readonly OrderStatus[] = [
  "AWAITING_DEPOSIT",
  "DEPOSIT_SUBMITTED",
  "DEPOSIT_VERIFIED",
  "PENDING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "QUALITY_CHECK",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "FAILED_DELIVERY",
];

// Custom print request lifecycle.
const CUSTOM_TRANSITIONS: Record<CustomRequestStatus, readonly CustomRequestStatus[]> = {
  SUBMITTED: ["IN_REVIEW", "QUOTED", "REJECTED", "CANCELLED"],
  IN_REVIEW: ["QUOTED", "REJECTED", "CANCELLED"],
  QUOTED: ["QUOTED", "REJECTED", "CANCELLED"], // re-quote allowed; ACCEPTED/DECLINED are customer actions
  ACCEPTED: [],
  DECLINED: ["QUOTED"],
  REJECTED: [],
  CANCELLED: [],
};

export function canAdminTransitionCustomRequest(from: CustomRequestStatus, to: CustomRequestStatus): boolean {
  return CUSTOM_TRANSITIONS[from].includes(to);
}
