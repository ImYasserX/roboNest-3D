
// Business rules for delivery and deposits, shared by checkout, custom-print
// quote acceptance, the cart preview and the admin. The server always
// recalculates with these functions; nothing here trusts a browser total.

/** Every supported delivery location costs the same (owner decision, 2026-10). */
export const FLAT_DELIVERY_FEE_IQD = 5_000;

/**
 * Orders whose deposit base is STRICTLY greater than this need an insurance
 * deposit verified by staff before the order is confirmed. 50,000 exactly
 * does not qualify.
 */
export const DEPOSIT_THRESHOLD_IQD = 50_000;

/**
 * The amount compared with the threshold: the goods value after discounts,
 * excluding the delivery fee. Delivery is a fixed pass-through charge, while
 * the deposit protects the cost of producing the goods.
 */
export function depositBase(subtotal: number, discountTotal: number): number {
  return Math.max(0, subtotal - Math.max(0, discountTotal));
}

export function requiresDeposit(base: number): boolean {
  return base > DEPOSIT_THRESHOLD_IQD;
}

/** Approved by the owners (2026-10): the deposit is 30% of the deposit base. */
export const DEPOSIT_RATE_PERCENT = 30;

/**
 * 30% of the deposit base in whole IQD, rounded DOWN like every other
 * percentage in this project (see evaluateDiscount). Integer arithmetic only;
 * MAX_PRICE_IQD keeps base * 30 far below Number.MAX_SAFE_INTEGER. The same
 * formula is enforced by the orders_deposit_rule trigger (migration 0002).
 */
export function depositAmountFor(base: number): number {
  if (!requiresDeposit(base)) return 0;
  return Math.floor((base * DEPOSIT_RATE_PERCENT) / 100);
}

export type DepositConfig = {
  /** A real online provider (e.g. FIB) is configured and enabled for deposits. */
  onlineAvailable: boolean;
  /** Owners approved manual transfer verification as a temporary fallback, with at least one method enabled. */
  manualAvailable: boolean;
};

export type DepositTerms =
  | { required: false; amount: 0 }
  | { required: true; amount: number }
  | { required: true; amount: number; error: "deposit_unconfigured" };

/**
 * Decides the deposit for an order. A high-value order can never bypass the
 * requirement: with no way to pay the deposit (no online provider and no
 * owner-approved manual fallback), it cannot be placed online at all.
 */
export function resolveDepositTerms(config: DepositConfig, base: number): DepositTerms {
  if (!requiresDeposit(base)) return { required: false, amount: 0 };
  const amount = depositAmountFor(base);
  if (!config.onlineAvailable && !config.manualAvailable) return { required: true, amount, error: "deposit_unconfigured" };
  return { required: true, amount };
}
