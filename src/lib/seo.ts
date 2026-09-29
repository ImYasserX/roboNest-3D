import type { Metadata } from "next";

/** Canonical + hreflang alternates for a path without the locale prefix ("" for home). */
export function alternates(locale: string, path: string): Metadata["alternates"] {
  const suffix = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return {
    canonical: `/${locale}${suffix}`,
    languages: {
      "ar-IQ": `/ar${suffix}`,
      en: `/en${suffix}`,
      "x-default": `/ar${suffix}`,
    },
  };
}
