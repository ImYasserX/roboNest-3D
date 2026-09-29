import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listProductsAdmin } from "@/server/services/product-admin";
import { hasPermission } from "@/lib/permissions";
import { AVAILABILITY, PRODUCT_STATUSES, PRODUCT_TYPES } from "@/lib/domain";
import { formatIQD } from "@/lib/money";
import { formatDate, pick } from "@/lib/localize";
import { Link } from "@/i18n/navigation";
import { DataTable } from "@/components/admin/table";
import { AdminPageHeader, AdminPagination, FilterBar } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/products">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.products" }))("title") };
}

export default async function AdminProductsPage({ params, searchParams }: PageProps<"/[locale]/admin/products">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "products.view");
  const [t, tc, ts, lang] = await Promise.all([getTranslations("admin.products"), getTranslations("admin.common"), getTranslations("status"), getLocale()]);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const result = await listProductsAdmin(await getDb(), sp);
  return (
    <div>
      <AdminPageHeader title={t("title")} description={tc("results", { count: result.total })}>
        {hasPermission(admin.role, "products.edit") ? <ButtonLink href="/admin/products/new">{t("new")}</ButtonLink> : null}
      </AdminPageHeader>
      {sp.deleted ? <Alert tone="success" className="mb-4">{t("deleted")}</Alert> : null}
      <FilterBar
        action={`/${locale}/admin/products`}
        q={result.query.q}
        placeholder={t("searchPlaceholder")}
        selects={[
          { name: "status", label: tc("status"), value: result.query.status, options: PRODUCT_STATUSES.map((s) => [s, t(`status.${s}`)]) },
          { name: "type", label: t("type"), value: result.query.type, options: PRODUCT_TYPES.map((s) => [s, ts(`productType.${s}`)]) },
          { name: "availability", label: t("stock"), value: result.query.availability, options: AVAILABILITY.map((s) => [s, ts(`availability.${s}`)]) },
          { name: "sort", label: tc("sort"), value: result.query.sort, options: [["updated", tc("updated")], ["name", tc("name")], ["price_asc", `${t("price")} ↑`], ["price_desc", `${t("price")} ↓`], ["stock", t("stock")]] },
        ]}
      />
      <DataTable
        caption={t("title")}
        empty={tc("noResults")}
        rows={result.rows}
        rowKey={(r) => r.id}
        columns={[
          { key: "n", header: tc("name"), cell: (r) => <Link href={`/admin/products/${r.id}`} className="font-semibold text-primary-text underline">{pick(lang, r.nameEn, r.nameAr)}</Link> },
          { key: "c", header: t("category"), cell: (r) => pick(lang, r.categoryNameEn, r.categoryNameAr) },
          { key: "t", header: t("type"), cell: (r) => ts(`productType.${r.productType}`) },
          { key: "s", header: tc("status"), cell: (r) => <Badge tone={r.status === "PUBLISHED" ? "success" : r.status === "DRAFT" ? "warning" : "neutral"}>{t(`status.${r.status}`)}</Badge> },
          { key: "a", header: t("stock"), cell: (r) => <span>{ts(`availability.${r.availability}`)}{r.availability === "IN_STOCK" ? <span className="ltr-nums"> ({r.stockQuantity})</span> : null}</span> },
          { key: "p", header: t("price"), align: "end", cell: (r) => <span className="ltr-nums">{formatIQD(r.salePrice ?? r.basePrice, lang)}</span> },
          { key: "u", header: tc("updated"), cell: (r) => formatDate(r.updatedAt, lang) },
        ]}
      />
      <AdminPagination page={result.page} pageCount={result.pageCount} path="/admin/products" params={sp} />
    </div>
  );
}
