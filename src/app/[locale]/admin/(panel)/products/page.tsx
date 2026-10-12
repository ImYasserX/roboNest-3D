import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { categoryOptions } from "@/server/admin-categories";
import { PRODUCT_PAGE_SIZE, listProductMaterials, listProductsAdmin } from "@/server/services/product-admin";
import { MAX_BULK } from "@/server/services/product-bulk";
import { hasPermission } from "@/lib/permissions";
import { AVAILABILITY, PRODUCT_STATUSES, PRODUCT_TYPES } from "@/lib/domain";
import { formatIQD } from "@/lib/money";
import { formatDate, pick } from "@/lib/localize";
import { ProductBulkManager } from "@/components/admin/product-bulk-manager";
import { AdminPageHeader, AdminPagination, FilterBar } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { Alert } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/products">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.products" }))("title") };
}

export default async function AdminProductsPage({ params, searchParams }: PageProps<"/[locale]/admin/products">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "products.view");
  const [t, tb, tc, ts, lang] = await Promise.all([getTranslations("admin.products"), getTranslations("admin.products.bulk"), getTranslations("admin.common"), getTranslations("status"), getLocale()]);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const db = await getDb();
  const [result, cats, materials] = await Promise.all([listProductsAdmin(db, sp), categoryOptions(db, lang), listProductMaterials(db)]);
  const canEdit = hasPermission(admin.role, "products.edit");
  const canDelete = hasPermission(admin.role, "products.delete");
  // The active filters, as the server will re-apply them for "select all matching".
  const filter = Object.fromEntries(
    (["q", "status", "type", "availability", "category", "material", "featured"] as const).flatMap((k) => (result.query[k] ? [[k, String(result.query[k])]] : [])),
  );
  const rows = result.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: pick(lang, r.nameEn, r.nameAr),
    category: pick(lang, r.categoryNameEn, r.categoryNameAr) ?? "",
    type: ts(`productType.${r.productType}`),
    status: r.status,
    statusLabel: t(`status.${r.status}`),
    availability: `${ts(`availability.${r.availability}`)}${r.availability === "IN_STOCK" ? ` (${r.stockQuantity ?? 0})` : ""}`,
    price: formatIQD(r.salePrice ?? r.basePrice, lang),
    updated: formatDate(r.updatedAt, lang),
    featured: r.isFeatured,
  }));

  return (
    <div>
      <AdminPageHeader title={t("title")} description={tb("description", { count: result.total })} breadcrumbs={[{ label: tc("dashboard"), href: "/admin" }, { label: t("title") }]}>
        {canEdit ? <ButtonLink href="/admin/products/new"><PlusIcon size={16} /> {t("new")}</ButtonLink> : null}
      </AdminPageHeader>
      {sp.deleted ? <Alert tone="success" className="mb-4">{t("deleted")}</Alert> : null}
      {canEdit || canDelete ? <p className="mb-3 text-sm text-muted">{tb("howTo")}</p> : null}
      <FilterBar
        action={`/${locale}/admin/products`}
        q={result.query.q}
        placeholder={t("searchPlaceholder")}
        selects={[
          { name: "status", label: tc("status"), value: result.query.status, options: PRODUCT_STATUSES.map((s) => [s, t(`status.${s}`)]) },
          { name: "category", label: t("category"), value: result.query.category, options: cats.map((c) => [c.id, c.group === c.label ? c.label : `${c.group} › ${c.label}`]) },
          { name: "type", label: t("type"), value: result.query.type, options: PRODUCT_TYPES.map((s) => [s, ts(`productType.${s}`)]) },
          { name: "material", label: tb("fields.materials"), value: result.query.material, options: materials.map((m) => [m, m]) },
          { name: "availability", label: t("stock"), value: result.query.availability, options: AVAILABILITY.map((s) => [s, ts(`availability.${s}`)]) },
          { name: "featured", label: tb("fields.isFeatured"), value: result.query.featured, options: [["1", tc("yes")], ["0", tc("no")]] },
          {
            name: "sort",
            label: tc("sort"),
            value: result.query.sort,
            options: [["updated", tc("updated")], ["created", tb("sortCreated")], ["name", tc("name")], ["price_asc", `${t("price")} ↑`], ["price_desc", `${t("price")} ↓`], ["status", tc("status")], ["stock", t("stock")]],
          },
        ]}
      />
      <ProductBulkManager
        key={JSON.stringify({ ...filter, page: result.page })}
        rows={rows}
        total={result.total}
        filter={filter}
        maxBulk={MAX_BULK}
        canEdit={canEdit}
        canDelete={canDelete}
        options={{
          statuses: PRODUCT_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
          categories: cats.map((c) => ({ value: c.id, label: c.group === c.label ? c.label : `${c.group} › ${c.label}` })),
          availability: AVAILABILITY.map((s) => ({ value: s, label: ts(`availability.${s}`) })),
        }}
      />
      <AdminPagination page={result.page} pageCount={result.pageCount} path="/admin/products" params={sp} total={result.total} pageSize={PRODUCT_PAGE_SIZE} />
    </div>
  );
}
