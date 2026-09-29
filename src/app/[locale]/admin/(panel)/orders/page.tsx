import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listOrdersAdmin } from "@/server/services/admin-orders";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/domain";
import { formatIQD } from "@/lib/money";
import { formatDate, pick } from "@/lib/localize";
import { formatIraqiPhone } from "@/lib/phone";
import { Link } from "@/i18n/navigation";
import { DataTable } from "@/components/admin/table";
import { AdminPageHeader, AdminPagination, FilterBar } from "@/components/admin/ui";
import { Badge } from "@/components/ui/misc";
import { orderStatusTone } from "@/lib/status-tone";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/orders">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.orders" }))("title") };
}

export default async function AdminOrdersPage({ params, searchParams }: PageProps<"/[locale]/admin/orders">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "orders.view");
  const [t, tc, ts, lang] = await Promise.all([getTranslations("admin.orders"), getTranslations("admin.common"), getTranslations("status"), getLocale()]);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const result = await listOrdersAdmin(await getDb(), sp);
  return (
    <div>
      <AdminPageHeader title={t("title")} description={tc("results", { count: result.total })} />
      <FilterBar
        action={`/${locale}/admin/orders`}
        q={result.query.q}
        placeholder={t("searchPlaceholder")}
        selects={[
          { name: "status", label: tc("status"), value: result.query.status, options: ORDER_STATUSES.map((s) => [s, ts(`order.${s}`)]) },
          { name: "payment", label: t("payment"), value: result.query.payment, options: PAYMENT_STATUSES.map((s) => [s, ts(`payment.${s}`)]) },
          { name: "sort", label: tc("sort"), value: result.query.sort, options: [["newest", tc("newest")], ["oldest", tc("oldest")], ["total_desc", `${tc("total")} ↓`], ["total_asc", `${tc("total")} ↑`]] },
        ]}
      />
      <DataTable
        caption={t("title")}
        empty={tc("noResults")}
        rows={result.rows}
        rowKey={(r) => r.id}
        columns={[
          { key: "n", header: "#", cell: (r) => <Link href={`/admin/orders/${r.id}`} className="ltr-nums font-semibold text-primary-text underline">{r.orderNumber}</Link> },
          { key: "c", header: t("customer"), cell: (r) => <span>{r.customerName}<br /><span className="ltr-nums text-xs text-muted">{formatIraqiPhone(r.customerPhone)}</span></span> },
          { key: "g", header: t("governorate"), cell: (r) => (r.hasPhysical ? pick(lang, r.governorateEn, r.governorateAr) : t("digital")) },
          { key: "s", header: tc("status"), cell: (r) => <Badge tone={orderStatusTone(r.status)}>{ts(`order.${r.status}`)}</Badge> },
          { key: "p", header: t("payment"), cell: (r) => <Badge tone={r.paymentStatus === "PAID" ? "success" : "neutral"}>{ts(`payment.${r.paymentStatus}`)}</Badge> },
          { key: "d", header: tc("date"), cell: (r) => formatDate(r.createdAt, lang, true) },
          { key: "t", header: tc("total"), align: "end", cell: (r) => <span className="ltr-nums font-medium">{formatIQD(r.total, lang)}</span> },
        ]}
      />
      <AdminPagination page={result.page} pageCount={result.pageCount} path="/admin/orders" params={sp} />
    </div>
  );
}
