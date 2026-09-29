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

export const ADMIN_ROLES = ["SUPER_ADMIN", "OPERATIONS"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ACCOUNT_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const CONTACT_STATUSES = ["NEW", "READ", "ARCHIVED"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const DIGITAL_FORMATS = ["STL", "3MF", "OBJ", "GLB", "ZIP"] as const;
export type DigitalFormat = (typeof DIGITAL_FORMATS)[number];

/** Upper bounds that keep integer money math far from overflow. */
export const MAX_PRICE_IQD = 100_000_000;
export const MAX_LINE_QUANTITY = 100;
export const MAX_CART_LINES = 50;
