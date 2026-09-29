import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { parsePeriod } from "@/server/admin-period";
import { getDashboard } from "@/server/services/analytics";
import { hasPermission } from "@/lib/permissions";
import { formatIQD } from "@/lib/money";
import { pick } from "@/lib/localize";
import { chartSummary } from "@/lib/chart-summary";
import { BarChart } from "@/components/admin/bar-chart";
import { PeriodSelect } from "@/components/admin/period-select";
import { Stat } from "@/components/admin/stat";
import { DataTable } from "@/components/admin/table";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { Alert } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/analytics">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.nav" });
  return { title: t("analytics") };
}

export default async function AnalyticsPage({ params, searchParams }: PageProps<"/[locale]/admin/analytics">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "analytics.view");
  const [t, tn, ts, lang] = await Promise.all([getTranslations("admin.dashboard"), getTranslations("admin.nav"), getTranslations("status"), getLocale()]);
  const days = parsePeriod((await searchParams).days);
  const canProfit = hasPermission(admin.role, "analytics.profit");
  const d = await getDashboard(await getDb(), days, { includeProfit: canProfit });
  const iqd = (n: number) => formatIQD(n, lang);
  const num = (n: number) => new Intl.NumberFormat(lang === "ar" ? "ar-IQ-u-nu-latn" : "en-US").format(n);
  const tableLabel = { show: t("showTable"), date: t("date"), value: t("value") };

  return (
    <div className="space-y-6">
      <AdminPageHeader title={tn("analytics")}>
        <PeriodSelect action={`/${locale}/admin/analytics`} value={days} />
      </AdminPageHeader>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("goodsRevenue")} value={iqd(d.goodsRevenue)} hint={t("goodsRevenueHint")} />
        <Stat label={t("deliveryFees")} value={iqd(d.deliveryFees)} />
        <Stat label={t("aov")} value={iqd(d.averageOrderValue)} />
        <Stat label={t("openOrders")} value={num(d.openOrders)} hint={t("openValue", { value: iqd(d.openValue) })} />
      </dl>

      {d.profit ? (
        <Panel title={t("profit")} id="profit">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Stat label={t("profit")} value={iqd(d.profit.grossProfit)} hint={t("profitHint", { percent: `${Math.round(d.profit.costCoverage * 100)}%` })} />
            <Stat label={t("goodsRevenue")} value={iqd(d.profit.costedRevenue)} />
          </dl>
        </Panel>
      ) : (
        <Alert tone="info">{t("profitHidden")}</Alert>
      )}

      <Panel>
        <BarChart title={t("revenueChart")} points={d.revenueSeries} format="iqd" locale={lang} tableLabel={tableLabel} summary={chartSummary(t as never, t("revenueChart"), d.revenueSeries, iqd)} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t("topProducts")} id="top">
          <DataTable
            caption={t("topProducts")}
            empty={t("noData")}
            rows={d.topProducts}
            rowKey={(r) => `${r.productId}-${r.nameEn}`}
            columns={[
              { key: "p", header: t("product"), cell: (r) => pick(lang, r.nameEn, r.nameAr) },
              { key: "q", header: t("quantity"), align: "end", cell: (r) => <span className="ltr-nums">{num(r.quantity)}</span> },
              { key: "r", header: t("revenue"), align: "end", cell: (r) => <span className="ltr-nums">{iqd(r.revenue)}</span> },
            ]}
          />
        </Panel>
        <Panel title={t("deliveryByZone")} id="zones">
          <DataTable
            caption={t("deliveryByZone")}
            empty={t("noData")}
            rows={d.deliveryByZone}
            rowKey={(r) => r.governorateEn ?? "?"}
            columns={[
              { key: "g", header: t("governorate"), cell: (r) => pick(lang, r.governorateEn, r.governorateAr) },
              { key: "o", header: t("orders"), align: "end", cell: (r) => <span className="ltr-nums">{num(r.orders)}</span> },
              { key: "d", header: t("delivered"), align: "end", cell: (r) => <span className="ltr-nums">{num(r.delivered)}</span> },
              { key: "f", header: t("failed"), align: "end", cell: (r) => <span className="ltr-nums">{num(r.failed)}</span> },
              { key: "fee", header: t("fees"), align: "end", cell: (r) => <span className="ltr-nums">{iqd(r.fees)}</span> },
            ]}
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t("customers")} id="cust">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Stat label={t("customers")} value={num(d.customers.registered)} hint={t("newCustomers", { count: d.customers.newInPeriod })} />
            <Stat label={t("repeat")} value={num(d.customers.repeatCustomers)} hint={t("repeatValue", { repeat: d.customers.repeatCustomers, unique: d.customers.uniqueCustomers })} />
          </dl>
        </Panel>
        <Panel title={t("customRequests")} id="cr">
          {Object.keys(d.customRequests).length === 0 ? (
            <p className="text-sm text-muted">{t("noData")}</p>
          ) : (
            <dl className="grid gap-2 sm:grid-cols-2">
              {Object.entries(d.customRequests).map(([status, count]) => (
                <div key={status} className="flex justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <dt>{ts(`customRequest.${status}`)}</dt>
                  <dd className="ltr-nums font-semibold">{num(count)}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
      </div>
    </div>
  );
}
