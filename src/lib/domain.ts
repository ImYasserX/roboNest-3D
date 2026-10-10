// Domain vocabulary shared by the database schema, validation, business logic
// and UI. Safe to import from client components (no server-only code here).

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";

export const CURRENCY = "IQD" as const;

export const PRODUCT_TYPES = [
  "PHYSICAL",
  "DIGITAL",
  "PHYSICAL_DIGITAL",
  "CUSTOMIZABLE",
  "CUSTOM_SERVICE",
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** Whether buying this product type ships something physical. */
export function typeHasPhysical(type: ProductType): boolean {
  return type !== "DIGITAL";
}

/** Whether buying this product type grants downloadable files. */
export function typeHasDigital(type: ProductType): boolean {
  return type === "DIGITAL" || type === "PHYSICAL_DIGITAL";
}

export const AVAILABILITY = [
  "MADE_TO_ORDER",
  "IN_STOCK",
  "OUT_OF_STOCK",
  "PREORDER",
  "DIGITAL",
] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const PRODUCT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const OPTION_TYPES = [
  "SELECT",
  "RADIO",
  "CHECKBOX",
  "NUMBER",
  "TEXT",
  "TEXTAREA",
  "FILE",
] as const;
export type OptionType = (typeof OPTION_TYPES)[number];

export const ORDER_STATUSES = [
  // High-value orders start here (see lib/payment-rules.ts) and only reach
  // CONFIRMED after an administrator verifies the deposit.
  "AWAITING_DEPOSIT",
  "DEPOSIT_SUBMITTED",
  "DEPOSIT_VERIFIED",
  "PENDING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "QUALITY_CHECK",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED_DELIVERY",
  "CANCELLED",
  "RETURN_REQUESTED",
  "RETURNED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ["COD"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["PENDING", "PAID", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Insurance-deposit state, separate from the cash-on-delivery balance. */
export const DEPOSIT_STATUSES = ["NOT_REQUIRED", "AWAITING", "SUBMITTED", "VERIFIED"] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

/** Manual transfer methods for deposits. No payment API is integrated. */
export const DEPOSIT_METHODS = ["FIB", "QICARD", "ZAINCASH"] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

export const CUSTOM_REQUEST_STATUSES = [
  "SUBMITTED",
  "IN_REVIEW",
  "QUOTED",
  "ACCEPTED",
  "DECLINED",
  "REJECTED",
  "CANCELLED",
] as const;
export type CustomRequestStatus = (typeof CUSTOM_REQUEST_STATUSES)[number];

export const DISCOUNT_TYPES = ["PERCENT", "FIXED"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const ADMIN_ROLES = ["OWNER", "SUPER_ADMIN", "OPERATIONS"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
/** Roles that can be granted from the admin UI. OWNER is only provisioned by the bootstrap script. */
export const ASSIGNABLE_ADMIN_ROLES = ["SUPER_ADMIN", "OPERATIONS"] as const;

export const ACCOUNT_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const CONTACT_STATUSES = ["NEW", "READ", "ARCHIVED"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export const CONTACT_DELIVERY_STATUSES = ["SENT", "FAILED", "NOT_CONFIGURED"] as const;

export const NOTIFICATION_KINDS = ["ORDER_PLACED", "DEPOSIT_SUBMITTED", "DEPOSIT_PAID", "TEST"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export const NOTIFICATION_STATUSES = ["PENDING", "SENDING", "SENT", "FAILED", "NOT_CONFIGURED"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const PHONE_VERIFICATION_PURPOSES = ["REGISTER", "LOGIN", "RESET"] as const;
export type PhoneVerificationPurpose = (typeof PHONE_VERIFICATION_PURPOSES)[number];

export const DIGITAL_FORMATS = ["STL", "3MF", "OBJ", "GLB", "ZIP"] as const;
export type DigitalFormat = (typeof DIGITAL_FORMATS)[number];

/** Upper bounds that keep integer money math far from overflow. */
export const MAX_PRICE_IQD = 100_000_000;
export const MAX_LINE_QUANTITY = 100;
export const MAX_CART_LINES = 50;
