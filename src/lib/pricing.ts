import {
  MAX_LINE_QUANTITY,
  MAX_PRICE_IQD,
  type Availability,
  type DiscountType,
  type OptionType,
  type ProductStatus,
  type ProductType,
} from "./domain";

// Pure pricing and validation rules. The server runs these against database
// records on every cart read and again at checkout; nothing here trusts a
// price sent by the browser. Client code may import this module only to show
// a live preview — the server result is always authoritative.

export type LocalizedText = { en: string; ar: string };

export type PricingOptionValue = {
  id: string;
  labelEn: string;
  labelAr: string;
  priceDelta: number;
  isActive: boolean;
};

export type PricingOption = {
  id: string;
  type: OptionType;
  labelEn: string;
  labelAr: string;
  isRequired: boolean;
  priceDelta: number;
  pricePerUnit: number;
  minValue: number | null;
  maxValue: number | null;
  unitEn: string;
  unitAr: string;
  values: PricingOptionValue[];
};

export type PricingProduct = {
  id: string;
  productType: ProductType;
  status: ProductStatus;
  availability: Availability;
  stockQuantity: number | null;
  basePrice: number;
  salePrice: number | null;
  options: PricingOption[];
};

export type SelectionValue = string | string[] | number | boolean;
export type Selections = Record<string, SelectionValue>;

export type OptionSnapshot = {
  optionId: string;
  label: LocalizedText;
  value: LocalizedText;
  priceDelta: number;
  uploadId?: string;
};

export type LineErrorCode =
  | "product_unavailable"
  | "out_of_stock"
  | "insufficient_stock"
  | "invalid_quantity"
  | "unknown_option"
  | "required"
  | "invalid_value"
  | "out_of_range"
  | "too_short"
  | "too_long"
  | "price_overflow";

export type LineError = { code: LineErrorCode; optionId?: string };

export type ResolvedLine = {
  unitPrice: number;
  lineTotal: number;
  quantity: number;
  /** Canonical selections (unknown keys removed, types normalized). */
  selections: Selections;
  snapshot: OptionSnapshot[];
  uploadIds: string[];
};

export const TEXT_MAX_DEFAULT = 120;
export const TEXTAREA_MAX_DEFAULT = 1000;
// Control characters other than tab/newline are never valid in customer text.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function effectiveBasePrice(p: Pick<PricingProduct, "basePrice" | "salePrice">): number {
  return p.salePrice !== null && p.salePrice < p.basePrice ? p.salePrice : p.basePrice;
}

/** Whether the product can currently be added to a cart, ignoring quantity. */
export function isPurchasable(p: Pick<PricingProduct, "status" | "availability" | "stockQuantity">): boolean {
  if (p.status !== "PUBLISHED") return false;
  if (p.availability === "OUT_OF_STOCK") return false;
  if (p.availability === "IN_STOCK") return (p.stockQuantity ?? 0) > 0;
  // MADE_TO_ORDER, PREORDER and DIGITAL are never limited by physical stock.
  return true;
}

export function resolveLine(product: PricingProduct, rawSelections: unknown, quantity: unknown):
  | { ok: true; line: ResolvedLine }
  | { ok: false; errors: LineError[] } {
  const errors: LineError[] = [];

  if (!isPurchasable(product)) {
    return {
      ok: false,
      errors: [{ code: product.availability === "IN_STOCK" || product.availability === "OUT_OF_STOCK" ? "out_of_stock" : "product_unavailable" }],
    };
  }
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
    return { ok: false, errors: [{ code: "invalid_quantity" }] };
  }
  if (product.availability === "IN_STOCK" && quantity > (product.stockQuantity ?? 0)) {
    return { ok: false, errors: [{ code: "insufficient_stock" }] };
  }

  const selections: Selections =
    rawSelections && typeof rawSelections === "object" && !Array.isArray(rawSelections)
      ? (rawSelections as Selections)
      : {};
  const optionsById = new Map(product.options.map((o) => [o.id, o]));
  for (const key of Object.keys(selections)) {
    if (!optionsById.has(key)) errors.push({ code: "unknown_option", optionId: key });
  }

  const normalized: Selections = {};
  const snapshot: OptionSnapshot[] = [];
  const uploadIds: string[] = [];
  let unitPrice = effectiveBasePrice(product);

  for (const option of product.options) {
    const raw = selections[option.id];
    const label = { en: option.labelEn, ar: option.labelAr };
    const isEmpty =
      raw === undefined ||
      raw === null ||
      raw === "" ||
      raw === false ||
      (Array.isArray(raw) && raw.length === 0);
    if (isEmpty) {
      if (option.isRequired) errors.push({ code: "required", optionId: option.id });
      continue;
    }
    const activeValues = new Map(option.values.filter((v) => v.isActive).map((v) => [v.id, v]));

    switch (option.type) {
      case "SELECT":
      case "RADIO": {
        const value = typeof raw === "string" ? activeValues.get(raw) : undefined;
        if (!value) {
          errors.push({ code: "invalid_value", optionId: option.id });
          break;
        }
        normalized[option.id] = value.id;
        unitPrice += value.priceDelta;
        snapshot.push({ optionId: option.id, label, value: { en: value.labelEn, ar: value.labelAr }, priceDelta: value.priceDelta });
        break;
      }
      case "CHECKBOX": {
        if (option.values.length === 0) {
          if (raw !== true) {
            errors.push({ code: "invalid_value", optionId: option.id });
            break;
          }
          normalized[option.id] = true;
          unitPrice += option.priceDelta;
          snapshot.push({ optionId: option.id, label, value: { en: "Yes", ar: "نعم" }, priceDelta: option.priceDelta });
          break;
        }
        const ids = Array.isArray(raw) ? raw : [raw];
        const unique = [...new Set(ids)];
        const chosen = unique.map((vid) => (typeof vid === "string" ? activeValues.get(vid) : undefined));
        if (unique.length !== ids.length || chosen.some((v) => !v)) {
          errors.push({ code: "invalid_value", optionId: option.id });
          break;
        }
        const values = chosen as PricingOptionValue[];
        // Keep admin-defined order so equal selections produce equal line keys.
        const ordered = option.values.filter((v) => values.includes(v));
        const delta = ordered.reduce((sum, v) => sum + v.priceDelta, 0);
        normalized[option.id] = ordered.map((v) => v.id);
        unitPrice += delta;
        snapshot.push({
          optionId: option.id,
          label,
          value: { en: ordered.map((v) => v.labelEn).join(", "), ar: ordered.map((v) => v.labelAr).join("، ") },
          priceDelta: delta,
        });
        break;
      }
      case "NUMBER": {
        const num = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
        if (typeof num !== "number" || !Number.isInteger(num)) {
          errors.push({ code: "invalid_value", optionId: option.id });
          break;
        }
        const min = option.minValue ?? 0;
        const max = option.maxValue ?? 1_000_000;
        if (num < min || num > max) {
          errors.push({ code: "out_of_range", optionId: option.id });
          break;
        }
        const delta = option.pricePerUnit * (num - min);
        normalized[option.id] = num;
        unitPrice += delta;
        snapshot.push({
          optionId: option.id,
          label,
          value: { en: `${num}${option.unitEn ? ` ${option.unitEn}` : ""}`, ar: `${num}${option.unitAr ? ` ${option.unitAr}` : ""}` },
          priceDelta: delta,
        });
        break;
      }
      case "TEXT":
      case "TEXTAREA": {
        if (typeof raw !== "string") {
          errors.push({ code: "invalid_value", optionId: option.id });
          break;
        }
        const text = option.type === "TEXT" ? raw.replace(/\s+/g, " ").trim() : raw.replace(/\r\n/g, "\n").trim();
        if (text.length === 0) {
          if (option.isRequired) errors.push({ code: "required", optionId: option.id });
          break;
        }
        if (CONTROL_CHARS.test(text) || (option.type === "TEXT" && text.includes("\n"))) {
          errors.push({ code: "invalid_value", optionId: option.id });
          break;
        }
        const maxLen = option.maxValue ?? (option.type === "TEXT" ? TEXT_MAX_DEFAULT : TEXTAREA_MAX_DEFAULT);
        if (text.length < (option.minValue ?? 0)) {
          errors.push({ code: "too_short", optionId: option.id });
          break;
        }
        if (text.length > maxLen) {
          errors.push({ code: "too_long", optionId: option.id });
          break;
        }
        normalized[option.id] = text;
        unitPrice += option.priceDelta;
        snapshot.push({ optionId: option.id, label, value: { en: text, ar: text }, priceDelta: option.priceDelta });
        break;
      }
      case "FILE": {
        if (typeof raw !== "string" || !UUID.test(raw)) {
          errors.push({ code: "invalid_value", optionId: option.id });
          break;
        }
        normalized[option.id] = raw;
        uploadIds.push(raw);
        unitPrice += option.priceDelta;
        snapshot.push({ optionId: option.id, label, value: { en: "Uploaded file", ar: "ملف مرفوع" }, priceDelta: option.priceDelta, uploadId: raw });
        break;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (unitPrice > MAX_PRICE_IQD || unitPrice * quantity > MAX_PRICE_IQD) {
    return { ok: false, errors: [{ code: "price_overflow" }] };
  }
  return {
    ok: true,
    line: { unitPrice, quantity, lineTotal: unitPrice * quantity, selections: normalized, snapshot, uploadIds },
  };
}

/** Stable JSON (sorted keys) so equal selections hash to the same line key. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------

export type DiscountRule = {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  maxUses: number | null;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
};

export type DiscountErrorCode = "invalid" | "not_started" | "expired" | "exhausted" | "min_subtotal";

export function evaluateDiscount(
  rule: DiscountRule | null | undefined,
  subtotal: number,
  now = new Date(),
): { ok: true; amount: number } | { ok: false; error: DiscountErrorCode } {
  if (!rule || !rule.isActive) return { ok: false, error: "invalid" };
  if (rule.startsAt && now < rule.startsAt) return { ok: false, error: "not_started" };
  if (rule.endsAt && now >= rule.endsAt) return { ok: false, error: "expired" };
  if (rule.maxUses !== null && rule.usedCount >= rule.maxUses) return { ok: false, error: "exhausted" };
  if (subtotal < rule.minSubtotal) return { ok: false, error: "min_subtotal" };
  let amount =
    rule.type === "PERCENT" ? Math.floor((subtotal * Math.min(Math.max(rule.value, 0), 100)) / 100) : rule.value;
  if (rule.type === "PERCENT" && rule.maxDiscount !== null) amount = Math.min(amount, rule.maxDiscount);
  amount = Math.max(0, Math.min(amount, subtotal));
  return { ok: true, amount };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export type DeliveryZoneRule = { id: string; fee: number; isActive: boolean };
export type DeliveryAreaRule = { id: string; zoneId: string; fee: number; isActive: boolean };

export function resolveDeliveryFee(
  zone: DeliveryZoneRule | null | undefined,
  area: DeliveryAreaRule | null | undefined,
): { ok: true; fee: number } | { ok: false; error: "zone_unavailable" | "area_unavailable" } {
  if (!zone || !zone.isActive) return { ok: false, error: "zone_unavailable" };
  if (area) {
    if (area.zoneId !== zone.id || !area.isActive) return { ok: false, error: "area_unavailable" };
    return { ok: true, fee: area.fee };
  }
  return { ok: true, fee: zone.fee };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export type Totals = { subtotal: number; discountTotal: number; deliveryFee: number; total: number };

export function computeTotals(lineTotals: number[], discountAmount: number, deliveryFee: number): Totals {
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const discountTotal = Math.max(0, Math.min(discountAmount, subtotal));
  const fee = Math.max(0, deliveryFee);
  return { subtotal, discountTotal, deliveryFee: fee, total: subtotal - discountTotal + fee };
}
