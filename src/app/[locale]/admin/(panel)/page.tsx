import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { parsePeriod } from "@/server/admin-period";
import { listOrdersAdmin } from "@/server/services/admin-orders";
import { getDashboard } from "@/server/services/analytics";
import { hasPermission } from "@/lib/permissions";
import { formatIQD } from "@/lib/money";
import { formatDate } from "@/lib/localize";
import { Link } from "@/i18n/navigation";
import { BarChart } from "@/components/admin/bar-chart";
import { PeriodSelect } from "@/components/admin/period-select";
import { Stat } from "@/components/admin/stat";
import { DataTable } from "@/components/admin/table";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/misc";
import { chartSummary } from "@/lib/chart-summary";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.dashboard" });
  return { title: t("title") };
}

export default async function AdminDashboard({ params, searchParams }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "dashboard.view");
  const [t, ts, to, tc, lang] = await Promise.all([getTranslations("admin.dashboard"), getTranslations("status"), getTranslations("admin.orders"), getTranslations("admin.common"), getLocale()]);
  const days = parsePeriod((await searchParams).days);
  const db = await getDb();
  const canProfit = hasPermission(admin.role, "analytics.profit");
  const [d, recent] = await Promise.all([getDashboard(db, days, { includeProfit: canProfit }), listOrdersAdmin(db, {})]);
  const iqd = (n: number) => formatIQD(n, lang);
  const num = (n: number) => new Intl.NumberFormat(lang === "ar" ? "ar-IQ-u-nu-latn" : "en-US").format(n);
  const requests = Object.values(d.customRequests).reduce((a, b) => a + b, 0);
  const tableLabel = { show: t("showTable"), date: t("date"), value: t("value") };

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t("title")}>
        <PeriodSelect action={`/${locale}/admin`} value={days} />
      </AdminPageHeader>

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("goodsRevenue")} value={iqd(d.goodsRevenue)} hint={t("goodsRevenueHint")} />
        <Stat label={t("orders")} value={num(d.orders)} hint={`${t("delivered")}: ${num(d.deliveredCount)} · ${t("cancelled")}: ${num(d.cancelled)}`} />
        <Stat label={t("pendingNow")} value={num(d.pendingNow)} hint={t("openValue", { value: iqd(d.openValue) })} />
        <Stat label={t("aov")} value={iqd(d.averageOrderValue)} />
        <Stat label={t("customers")} value={num(d.customers.registered)} hint={t("newCustomers", { count: d.customers.newInPeriod })} />
        <Stat label={t("customRequests")} value={num(requests)} />
        <Stat label={t("digitalSales")} value={iqd(d.digital.revenue)} hint={`× ${num(d.digital.quantity)}`} />
        {d.profit ? (
          <Stat label={t("profit")} value={iqd(d.profit.grossProfit)} hint={t("profitHint", { percent: `${Math.round(d.profit.costCoverage * 100)}%` })} />
        ) : (
          <Stat label={t("profit")} value="—" hint={t("profitHidden")} />
        )}
      </dl>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <BarChart title={t("revenueChart")} points={d.revenueSeries} format="iqd" locale={lang} tableLabel={tableLabel} summary={chartSummary(t as never, t("revenueChart"), d.revenueSeries, iqd)} />
        </Panel>
        <Panel>
          <BarChart title={t("ordersChart")} points={d.orderSeries} format="count" locale={lang} tableLabel={tableLabel} summary={chartSummary(t as never, t("ordersChart"), d.orderSeries, num)} />
        </Panel>
      </div>

      <Panel title={t("recentOrders")} id="recent">
        <DataTable
          caption={t("recentOrders")}
          empty={t("noData")}
          rows={recent.rows.slice(0, 8)}
          rowKey={(r) => r.id}
          columns={[
            { key: "n", header: "#", cell: (r) => <Link href={`/admin/orders/${r.id}`} className="ltr-nums font-semibold text-primary-text underline">{r.orderNumber}</Link> },
            { key: "c", header: to("customer"), cell: (r) => r.customerName },
            { key: "s", header: tc("status"), cell: (r) => <Badge tone={r.status === "PENDING" ? "warning" : r.status === "DELIVERED" ? "success" : r.status === "CANCELLED" ? "danger" : "primary"}>{ts(`order.${r.status}`)}</Badge> },
            { key: "d", header: tc("date"), cell: (r) => formatDate(r.createdAt, lang, true) },
            { key: "t", header: tc("total"), align: "end", cell: (r) => <span className="ltr-nums">{iqd(r.total)}</span> },
          ]}
        />
      </Panel>
    </div>
  );
}
