import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/server/db/client";
import { getSiteUrl } from "@/server/env";
import { getCategoryTree, parseProductQuery } from "@/server/services/catalog";
import { pick } from "@/lib/localize";
import { listingMetadata } from "@/lib/listing-meta";
import { CatalogView } from "@/components/catalog/catalog-view";
import { Link } from "@/i18n/navigation";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { JsonLd } from "@/components/ui/json-ld";
import { Container, PageHeader } from "@/components/ui/misc";

async function loadCategory(slug: string) {
  const tree = await getCategoryTree(await getDb());
  const node = tree.bySlug.get(slug);
  return node ? { node, parent: node.parentId ? tree.byId.get(node.parentId) : undefined } : null;
}

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/categories/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const found = await loadCategory(slug);
  if (!found) return {};
  const t = await getTranslations({ locale, namespace: "catalog" });
  const name = pick(locale, found.node.nameEn, found.node.nameAr);
  const description = pick(locale, found.node.descriptionEn, found.node.descriptionAr) || `${name} — ${t("description")}`;
  return listingMetadata(locale, `/categories/${slug}`, name, description, await searchParams);
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/[locale]/categories/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const found = await loadCategory(slug);
  if (!found) notFound();
  const [t, tc, siteUrl] = await Promise.all([getTranslations("catalog"), getTranslations("common"), getSiteUrl()]);
  const { node, parent } = found;
  const name = pick(locale, node.nameEn, node.nameAr);
  const crumbs = [
    { label: tc("home"), href: "/" },
    { label: t("categoriesTitle"), href: "/categories" },
    ...(parent ? [{ label: pick(locale, parent.nameEn, parent.nameAr), href: `/categories/${parent.slug}` }] : []),
    { label: name },
  ];
  return (
    <Container className="space-y-8 py-10">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((c, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: c.label,
            ...(c.href ? { item: `${siteUrl}/${locale}${c.href === "/" ? "" : c.href}` } : {}),
          })),
        }}
      />
      <Breadcrumbs items={crumbs} />
      <PageHeader title={name} description={pick(locale, node.descriptionEn, node.descriptionAr) || undefined} />
      {node.children.length > 0 ? (
        <nav aria-label={t("categoriesTitle")}>
          <ul className="flex flex-wrap gap-2">
            {node.children.map((c) => (
              <li key={c.id}>
                <Link href={`/categories/${c.slug}`} className="inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm hover:border-primary/60 hover:bg-surface-2">
                  {pick(locale, c.nameEn, c.nameAr)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <CatalogView query={parseProductQuery(await searchParams)} basePath={`/categories/${slug}`} fixed={{ category: slug }} />
    </Container>
  );
}
