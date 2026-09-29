import type { MetadataRoute } from "next";
import { getDb } from "@/server/db/client";
import { getSiteUrl } from "@/server/env";
import { getCategoryTree, listPublishedSlugs } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

const STATIC_PATHS = ["", "/products", "/categories", "/models", "/custom-printing", "/about", "/contact", "/faq", "/delivery", "/returns", "/privacy", "/terms", "/track"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [siteUrl, db] = await Promise.all([getSiteUrl(), getDb()]);
  const [products, tree] = await Promise.all([listPublishedSlugs(db), getCategoryTree(db)]);
  // One entry per path with both language versions as alternates.
  const entry = (path: string, lastModified?: Date): MetadataRoute.Sitemap =>
    (["ar", "en"] as const).map((locale) => ({
      url: `${siteUrl}/${locale}${path}`,
      lastModified,
      alternates: { languages: { "ar-IQ": `${siteUrl}/ar${path}`, en: `${siteUrl}/en${path}` } },
    }));
  return [
    ...STATIC_PATHS.flatMap((p) => entry(p)),
    ...[...tree.byId.values()].flatMap((c) => entry(`/categories/${c.slug}`)),
    ...products.flatMap((p) => entry(`/products/${p.slug}`, p.updatedAt)),
  ];
}
