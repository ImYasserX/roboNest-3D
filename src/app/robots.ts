import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const siteUrl = await getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private or per-user pages; they are also marked noindex.
        disallow: ["/api/", "/ar/admin", "/en/admin", "/ar/account", "/en/account", "/ar/cart", "/en/cart", "/ar/checkout", "/en/checkout", "/ar/orders/", "/en/orders/", "/ar/search", "/en/search"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
