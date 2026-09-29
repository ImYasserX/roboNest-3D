import type { Metadata } from "next";
import { alternates } from "./seo";

/**
 * Listing pages: canonical is the unfiltered path; any filter/search state is
 * noindex so crawlers don't index thousands of near-duplicate URLs.
 */
export function listingMetadata(locale: string, path: string, title: string, description: string, searchParams: Record<string, unknown>): Metadata {
  const filtered = Object.entries(searchParams).some(([k, v]) => v !== undefined && v !== "" && k !== "page");
  return {
    title,
    description,
    alternates: alternates(locale, path),
    robots: filtered ? { index: false, follow: true } : undefined,
    openGraph: { title, description, url: `/${locale}${path}` },
  };
}
