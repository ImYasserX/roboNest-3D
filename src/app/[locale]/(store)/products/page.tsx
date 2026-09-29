import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { parseProductQuery } from "@/server/services/catalog";
import { listingMetadata } from "@/lib/listing-meta";
import { CatalogView } from "@/components/catalog/catalog-view";
import { Container, PageHeader } from "@/components/ui/misc";

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/products">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "catalog" });
  return listingMetadata(locale, "/products", t("title"), t("description"), await searchParams);
}

export default async function ProductsPage({ params, searchParams }: PageProps<"/[locale]/products">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("catalog");
  const query = parseProductQuery(await searchParams);
  return (
    <Container className="space-y-8 py-10">
      <PageHeader title={t("title")} description={t("description")} />
      <CatalogView query={query} basePath="/products" />
    </Container>
  );
}
