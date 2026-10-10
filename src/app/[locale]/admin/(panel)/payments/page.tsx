import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { savePaymentsAction } from "@/server/actions/admin/manage";
import { getDepositProvider } from "@/server/payments";
import { getSetting } from "@/server/services/settings";
import { DEPOSIT_METHODS } from "@/lib/domain";
import { formatDate } from "@/lib/localize";
import { formatIQD } from "@/lib/money";
import { DEPOSIT_RATE_PERCENT, DEPOSIT_THRESHOLD_IQD, FLAT_DELIVERY_FEE_IQD } from "@/lib/payment-rules";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { CheckboxField, TextAreaField } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/payments">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.payments" }))("title") };
}

export default async function PaymentsPage({ params }: PageProps<"/[locale]/admin/payments">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "payments.manage");
  const [t, tc, ts] = await Promise.all([getTranslations("admin.payments"), getTranslations("admin.common"), getTranslations("status")]);
  const [payments, provider] = await Promise.all([getSetting(await getDb(), "payments"), getDepositProvider()]);
  const manualReady = payments.manualFallback.approved && DEPOSIT_METHODS.some((m) => payments.methods[m].enabled);
  const payable = provider !== null || manualReady;
  return (
    <div className="max-w-3xl space-y-6">
      <AdminPageHeader title={t("title")} description={t("description")} />
      <Panel title={t("rules")} id="rules">
        <ul className="list-disc space-y-1 ps-5 text-sm">
          <li>{t("ruleDelivery", { fee: formatIQD(FLAT_DELIVERY_FEE_IQD, locale) })}</li>
          <li>{t("ruleThreshold", { threshold: formatIQD(DEPOSIT_THRESHOLD_IQD, locale) })}</li>
          <li>{t("ruleRate", { percent: DEPOSIT_RATE_PERCENT, example: formatIQD(Math.floor((60_000 * DEPOSIT_RATE_PERCENT) / 100), locale), base: formatIQD(60_000, locale) })}</li>
          <li>{t("ruleBase")}</li>
        </ul>
      </Panel>
      {!payable ? <Alert tone="warning" title={t("notConfiguredTitle")}>{t("notConfiguredText")}</Alert> : null}
      <Panel title={t("online")} id="online">
        <p className="text-sm">{provider ? t("onlineEnabled") : t("onlineDisabled")}</p>
        <p className="mt-2 text-sm text-muted">{t("onlineHint")}</p>
      </Panel>
      <Panel title={t("manual")} id="manual">
        <ActionForm action={savePaymentsAction} errorNamespace="admin.payments" className="space-y-5">
          <div className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
            <p>{t("manualExplain")}</p>
            {payments.manualFallback.approved ? (
              <p className="mt-1 font-semibold">{t("manualApprovedBy", { name: payments.manualFallback.approvedBy ?? "", date: payments.manualFallback.approvedAt ? formatDate(new Date(payments.manualFallback.approvedAt), locale, true) : "" })}</p>
            ) : null}
          </div>
          <CheckboxField
            id="manualApproved"
            name="manualApproved"
            label={t("manualApprove")}
            hint={admin.role === "OWNER" ? t("manualApproveHint") : t("manualOwnerOnly")}
            defaultChecked={payments.manualFallback.approved}
            disabled={admin.role !== "OWNER"}
          />
          {admin.role !== "OWNER" && payments.manualFallback.approved ? <input type="hidden" name="manualApproved" value="on" /> : null}
          {DEPOSIT_METHODS.map((m) => (
            <fieldset key={m} className="space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 font-semibold">{ts(`depositMethod.${m}`)}</legend>
              <CheckboxField id={`${m}_enabled`} name={`${m}_enabled`} label={t("enabled")} defaultChecked={payments.methods[m].enabled} />
              <div className="grid gap-3 md:grid-cols-2">
                <TextAreaField id={`${m}_en`} name={`${m}_en`} label={`${t("instructions")} (${tc("englishLabel")})`} hint={t("instructionsHint")} defaultValue={payments.methods[m].instructions.en} maxLength={600} rows={3} />
                <TextAreaField id={`${m}_ar`} name={`${m}_ar`} label={`${t("instructions")} (${tc("arabicLabel")})`} defaultValue={payments.methods[m].instructions.ar} maxLength={600} rows={3} dir="rtl" />
              </div>
            </fieldset>
          ))}
          <SubmitButton>{tc("save")}</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
