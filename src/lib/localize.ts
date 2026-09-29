import type { Locale } from "./domain";

/** Picks the Arabic or English variant, falling back to the other if empty. */
export function pick(locale: Locale | string, en: string | null | undefined, ar: string | null | undefined): string {
  const primary = locale === "ar" ? ar : en;
  const fallback = locale === "ar" ? en : ar;
  return (primary && primary.trim()) || fallback || "";
}

export function pickText(locale: Locale | string, value: { en: string; ar: string } | null | undefined): string {
  return value ? pick(locale, value.en, value.ar) : "";
}

export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

export function formatDate(date: Date | number, locale: Locale | string, withTime = false): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Asia/Baghdad",
  }).format(date);
}

export function formatBytes(bytes: number, locale: Locale | string): string {
  const units = locale === "ar" ? ["بايت", "ك.ب", "م.ب", "غ.ب"] : ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
