import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { parsePeriod } from "@/server/admin-period";
import { listOrdersAdmin } from "@/server/services/admin-orders";
import { getDashboard } from "@/server/services/analytics";
import { getOperationsOverview } from "@/server/services/admin-overview";
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
import { ButtonLink } from "@/components/ui/button";
import { PlusIcon, SlidersIcon, WalletIcon } from "@/components/ui/icons";
import { orderStatusTone } from "@/lib/status-tone";
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
  const [d, recent, ops] = await Promise.all([getDashboard(db, days, { includeProfit: canProfit }), listOrdersAdmin(db, {}), getOperationsOverview(db)]);
  const canPayments = hasPermission(admin.role, "payments.manage");
  const canProducts = hasPermission(admin.role, "products.edit");
  const awaiting = ops.payments.awaitingDeposit + ops.payments.awaitingFull;
  const iqd = (n: number) => formatIQD(n, lang);
  const num = (n: number) => new Intl.NumberFormat(lang === "ar" ? "ar-IQ-u-nu-latn" : "en-US").format(n);
  const requests = Object.values(d.customRequests).reduce((a, b) => a + b, 0);
  const tableLabel = { show: t("showTable"), date: t("date"), value: t("value") };

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t("title")} description={t("welcome", { name: admin.displayName })}>
        {canProducts ? <ButtonLink href="/admin/products/new" variant="secondary"><PlusIcon size={16} /> {t("newProduct")}</ButtonLink> : null}
        {canProducts ? <ButtonLink href="/admin/products?manage=1" variant="secondary"><SlidersIcon size={16} /> {t("bulkProducts")}</ButtonLink> : null}
        {canPayments ? <ButtonLink href="/admin/payments"><WalletIcon size={16} /> {t("verifyPayments")}</ButtonLink> : null}
      </AdminPageHeader>

      <section aria-labelledby="attention" className="space-y-3">
        <h2 id="attention" className="font-display text-lg font-semibold">{t("attention")}</h2>
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label={t("awaitingPayments")} value={num(awaiting)} tone={awaiting > 0 ? "warning" : "success"} hint={t("awaitingPaymentsHint", { deposits: num(ops.payments.awaitingDeposit), full: num(ops.payments.awaitingFull) })} href={canPayments ? "/admin/payments?view=awaiting" : undefined} />
          <Stat label={t("outstandingDeposits")} value={iqd(ops.outstandingDeposits.amount)} tone={ops.outstandingDeposits.count > 0 ? "warning" : "neutral"} hint={t("outstandingDepositsHint", { count: num(ops.outstandingDeposits.count) })} href={canPayments ? "/admin/payments?view=awaiting&kind=DEPOSIT" : undefined} />
          <Stat label={t("disputedPayments")} value={num(ops.payments.disputed)} tone={ops.payments.disputed > 0 ? "danger" : "neutral"} href={canPayments ? "/admin/payments?view=disputed" : undefined} />
          <Stat label={t("previewsPending")} value={num(ops.previewsPending)} tone={ops.previewsPending > 0 ? "primary" : "neutral"} hint={t("draftProducts", { count: num(ops.draftProducts) })} href={canProducts ? "/admin/digital-files?tab=previews" : undefined} />
        </dl>
        {ops.openByStatus.length ? (
          <ul className="flex flex-wrap gap-2" aria-label={t("openByStatus")}>
            {ops.openByStatus.map((s) => (
              <li key={s.status}>
                <Link href={`/admin/orders?status=${s.status}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-primary/50">
                  <Badge tone={orderStatusTone(s.status)}>{ts(`order.${s.status}`)}</Badge>
                  <span className="ltr-nums font-semibold">{num(s.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <h2 className="font-display text-lg font-semibold">{t("performance")}</h2>
        <PeriodSelect action={`/${locale}/admin`} value={days} />
      </div>

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
          <Stat label={t("profit")} value={tc("notSet")} hint={t("profitHidden")} />
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
            { key: "s", header: tc("status"), cell: (r) => <Badge tone={orderStatusTone(r.status)}>{ts(`order.${r.status}`)}</Badge> },
            { key: "p", header: to("payment"), cell: (r) => <Badge tone={r.paymentStatus === "PAID" ? "success" : r.paymentStatus === "DISPUTED" ? "danger" : "neutral"}>{ts(`payment.${r.paymentStatus}`)}</Badge> },
            { key: "d", header: tc("date"), cell: (r) => formatDate(r.createdAt, lang, true) },
            { key: "t", header: tc("total"), align: "end", cell: (r) => <span className="ltr-nums">{iqd(r.total)}</span> },
          ]}
        />
      </Panel>
    </div>
  );
}
