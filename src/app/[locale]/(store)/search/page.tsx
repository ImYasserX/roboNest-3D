import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { parseProductQuery } from "@/server/services/catalog";
import { alternates } from "@/lib/seo";
import { CatalogView } from "@/components/catalog/catalog-view";
import { Container, PageHeader } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/search">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "catalog" });
  // Search result pages are never indexed.
  return { title: t("searchTitle"), description: t("searchDescription"), alternates: alternates(locale, "/search"), robots: { index: false, follow: true } };
}

export default async function SearchPage({ params, searchParams }: PageProps<"/[locale]/search">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("catalog");
  const query = parseProductQuery(await searchParams);
  return (
    <Container className="space-y-8 py-10">
      <PageHeader title={query.q ? t("searchResultsFor", { query: query.q }) : t("searchTitle")} description={t("searchDescription")} />
      <CatalogView query={query} basePath="/search" showSearch />
    </Container>
  );
}
