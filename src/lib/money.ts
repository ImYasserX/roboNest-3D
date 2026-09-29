import type { Locale } from "./domain";

/** Formats whole Iraqi dinars, e.g. "25,000 IQD" / "25,000 د.ع". */
export function formatIQD(amount: number, locale: Locale | string): string {
  const n = new Intl.NumberFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-US", {
    maximumFractionDigits: 0,
  }).format(amount);
  // Non-breaking space: an amount never wraps away from its currency.
  return locale === "ar" ? `${n}\u00a0د.ع` : `${n}\u00a0IQD`;
}

export function isValidMoney(value: unknown, max = 100_000_000): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
