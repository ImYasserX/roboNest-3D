import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { savePaymentsAction } from "@/server/actions/admin/manage";
import { PAYMENT_QUEUE_PAGE_SIZE, listPaymentQueue, paymentQueueCounts } from "@/server/services/payment-verification";
import { getSetting } from "@/server/services/settings";
import { DEPOSIT_METHODS, PAYMENT_VERIFICATION_ACTIONS, PAYMENT_VERIFICATION_KINDS } from "@/lib/domain";
import { hasPermission } from "@/lib/permissions";
import { businessWhatsappUrl, BUSINESS } from "@/lib/business";
import { formatDate } from "@/lib/localize";
import { formatIQD } from "@/lib/money";
import { DEPOSIT_RATE_PERCENT, DEPOSIT_THRESHOLD_IQD, FLAT_DELIVERY_FEE_IQD } from "@/lib/payment-rules";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { PaymentDecisionButtons } from "@/components/admin/payment-panel";
import { DataTable } from "@/components/admin/table";
import { AdminPageHeader, AdminPagination, AdminTabs, FilterBar, Panel } from "@/components/admin/ui";
import { CheckboxField, TextAreaField } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/payments">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.payments" }))("title") };
}

export default async function PaymentsPage({ params, searchParams }: PageProps<"/[locale]/admin/payments">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "payments.manage");
  const [t, tq, tc, ts] = await Promise.all([getTranslations("admin.payments"), getTranslations("admin.paymentsQueue"), getTranslations("admin.common"), getTranslations("status")]);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const db = await getDb();
  const [queue, counts, payments] = await Promise.all([listPaymentQueue(db, sp), paymentQueueCounts(db), getSetting(db, "payments")]);
  const canVerify = hasPermission(admin.role, "payments.verify");
  const iqd = (n: number) => formatIQD(n, locale);
  const view = queue.query.view;
  const pageCount = Math.max(1, Math.ceil(queue.total / PAYMENT_QUEUE_PAGE_SIZE));

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t("title")} description={t("description")} breadcrumbs={[{ label: tc("dashboard"), href: "/admin" }, { label: t("title") }]} />

      {!canVerify ? <Alert tone="info">{tq("ownerOnly")}</Alert> : null}

      <AdminTabs
        label={t("title")}
        current={view}
        tabs={[
          { value: "awaiting", label: tq("tabs.awaiting"), count: counts.awaitingDeposit + counts.awaitingFull, href: "/admin/payments?view=awaiting" },
          { value: "disputed", label: tq("tabs.disputed"), count: counts.disputed, href: "/admin/payments?view=disputed" },
          { value: "history", label: tq("tabs.history"), href: "/admin/payments?view=history" },
          { value: "refunded", label: tq("tabs.refunded"), href: "/admin/payments?view=refunded" },
        ]}
      />

      <FilterBar
        action={`/${locale}/admin/payments`}
        q={queue.query.q}
        placeholder={tq("searchPlaceholder")}
        hidden={{ view }}
        selects={[
          { name: "kind", label: tq("purposeLabel"), value: queue.query.kind, options: PAYMENT_VERIFICATION_KINDS.map((k) => [k, tq(`purpose.${k}`)]) },
          ...(view === "history" ? [{ name: "action", label: tq("decision"), value: queue.query.action, options: PAYMENT_VERIFICATION_ACTIONS.map((a) => [a, tq(`actions.${a}`)] as [string, string]) }] : []),
        ]}
      />

      {view === "history" ? (
        <DataTable
          caption={tq("tabs.history")}
          empty={tq("emptyHistory")}
          rows={queue.history}
          rowKey={(r) => r.id}
          columns={[
            { key: "o", header: tq("reference"), cell: (r) => <Link href={`/admin/orders/${r.orderId}#payment`} className="ltr-nums font-mono font-semibold text-primary-text underline">{r.orderNumber}</Link> },
            { key: "a", header: tq("decision"), cell: (r) => <Badge tone={r.action === "CONFIRMED" ? "success" : r.action === "REFUND_RECORDED" ? "info" : "danger"}>{tq(`actions.${r.action}`)}</Badge> },
            { key: "k", header: tq("purposeLabel"), cell: (r) => tq(`purpose.${r.kind}`) },
            { key: "m", header: tq("amount"), align: "end", cell: (r) => <span className="ltr-nums">{iqd(r.amount)}</span> },
            { key: "c", header: tq("channel"), cell: (r) => (r.channel ? tq(`channels.${r.channel}`) : "—") },
            { key: "b", header: tq("by"), cell: (r) => r.adminName ?? r.adminLabel },
            { key: "d", header: tc("date"), cell: (r) => formatDate(r.createdAt, locale, true) },
            { key: "n", header: tq("note"), cell: (r) => <span className="line-clamp-2 max-w-64 break-words">{r.note ?? ""}</span> },
          ]}
        />
      ) : (
        <DataTable
          caption={tq(`tabs.${view}`)}
          empty={view === "awaiting" ? tq("emptyAwaiting") : tc("noResults")}
          rows={queue.orders}
          rowKey={(r) => r.id}
          columns={[
            { key: "o", header: tq("reference"), cell: (r) => <Link href={`/admin/orders/${r.id}#payment`} className="ltr-nums font-mono font-semibold text-primary-text underline">{r.orderNumber}</Link> },
            { key: "c", header: tq("customer"), cell: (r) => <span className="ltr-nums">{r.customerRef}</span> },
            { key: "p", header: tq("purposeLabel"), cell: (r) => (r.due ? (r.due.kind === "DEPOSIT" ? tq("purpose.DEPOSIT") : r.depositRequired ? tq("purpose.BALANCE") : tq("purpose.FULL")) : "—") },
            { key: "m", header: tq("amount"), align: "end", cell: (r) => <span className="ltr-nums font-semibold">{r.due ? iqd(r.due.amount) : iqd(r.total)} <span className="text-xs text-muted">{r.currency}</span></span> },
            { key: "w", header: tq("expected"), cell: (r) => (r.due ? (r.due.channel === "ON_DELIVERY" ? tq("expectedCod") : tq("expectedWhatsapp")) : "—") },
            { key: "s", header: tc("status"), cell: (r) => <span className="flex flex-wrap gap-1"><Badge>{ts(`order.${r.status}`)}</Badge><Badge tone={r.paymentStatus === "DISPUTED" ? "danger" : r.paymentStatus === "PAID" ? "success" : "warning"}>{ts(`payment.${r.paymentStatus}`)}</Badge></span> },
            { key: "d", header: tc("date"), cell: (r) => formatDate(r.createdAt, locale) },
            ...(canVerify && view !== "refunded" ? [{ key: "x", header: tc("actions"), cell: (r: (typeof queue.orders)[number]) => <PaymentDecisionButtons order={r} compact /> }] : []),
          ]}
        />
      )}
      <AdminPagination page={queue.query.page} pageCount={pageCount} path="/admin/payments" params={sp} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("rules")} id="rules">
          <ul className="list-disc space-y-1 ps-5 text-sm">
            <li>{t("ruleDelivery", { fee: iqd(FLAT_DELIVERY_FEE_IQD) })}</li>
            <li>{t("ruleThreshold", { threshold: iqd(DEPOSIT_THRESHOLD_IQD) })}</li>
            <li>{t("ruleRate", { percent: DEPOSIT_RATE_PERCENT, example: iqd(Math.floor((60_000 * DEPOSIT_RATE_PERCENT) / 100)), base: iqd(60_000) })}</li>
            <li>{t("ruleBase")}</li>
            <li>{t("ruleManual")}</li>
            <li>{t("ruleDownloads")}</li>
          </ul>
          <p className="mt-3 text-sm">
            {t("whatsappNumber")}: <a href={businessWhatsappUrl()} target="_blank" rel="noopener noreferrer" className="ltr-nums text-primary-text underline" dir="ltr">{BUSINESS.whatsapp.display}</a>
          </p>
          <p className="mt-2 text-xs text-muted">{t("onlineRetired")}</p>
        </Panel>
        <Panel title={t("manual")} id="manual">
          <ActionForm action={savePaymentsAction} errorNamespace="admin.payments" className="space-y-4">
            <p className="text-sm text-muted">{t("manualExplain")}</p>
            {DEPOSIT_METHODS.map((m) => (
              <fieldset key={m} className="space-y-3 rounded-lg border border-border p-4">
                <legend className="px-1 font-semibold">{ts(`depositMethod.${m}`)}</legend>
                <CheckboxField id={`${m}_enabled`} name={`${m}_enabled`} label={t("enabled")} defaultChecked={payments.methods[m].enabled} />
                <TextAreaField id={`${m}_en`} name={`${m}_en`} label={`${t("instructions")} (${tc("englishLabel")})`} hint={t("instructionsHint")} defaultValue={payments.methods[m].instructions.en} maxLength={600} rows={2} />
                <TextAreaField id={`${m}_ar`} name={`${m}_ar`} label={`${t("instructions")} (${tc("arabicLabel")})`} defaultValue={payments.methods[m].instructions.ar} maxLength={600} rows={2} dir="rtl" />
              </fieldset>
            ))}
            <SubmitButton>{tc("save")}</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
    </div>
  );
}
