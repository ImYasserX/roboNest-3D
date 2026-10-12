import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getEnv, getServerVar, getSiteUrl, outboundIntegrationsDisabled } from "@/server/env";
import { saveSecurityAction, sendTestEmailAction } from "@/server/actions/admin/manage";
import { contactEmailStatus } from "@/server/email-config";
import { getSetting } from "@/server/services/settings";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { CheckboxField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/settings">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.settings" }))("title") };
}

/** Which optional integrations have their secrets set. Names only, never values. */
async function integrationStatus() {
  const names = {
    email: ["RESEND_API_KEY", "CONTACT_FORM_EMAIL", "CONTACT_FROM_EMAIL"],
    telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_IDS"],
    sms: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"],
    whatsapp: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_GRAPH_API_VERSION", "WHATSAPP_OTP_TEMPLATE_NAME"],
    fib: ["FIB_ONLINE_DEPOSITS", "FIB_BASE_URL", "FIB_CLIENT_ID", "FIB_CLIENT_SECRET"],
  } as const;
  return Promise.all(
    (Object.keys(names) as (keyof typeof names)[]).map(async (key) => {
      const missing: string[] = [];
      for (const n of names[key]) {
        const v = await getServerVar(n);
        if (!v && !(n === "TELEGRAM_CHAT_IDS" && (await getServerVar("TELEGRAM_CHAT_ID")))) missing.push(n);
      }
      return { key, missing };
    }),
  );
}

export default async function SettingsPage({ params }: PageProps<"/[locale]/admin/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "settings.edit");
  const [t, tc] = await Promise.all([getTranslations("admin.settings"), getTranslations("admin.common")]);
  const [security, siteUrl, env, integrations, email, outboundOff] = await Promise.all([getSetting(await getDb(), "security"), getSiteUrl(), getEnv(), integrationStatus(), contactEmailStatus(), outboundIntegrationsDisabled()]);
  return (
    <div className="max-w-3xl space-y-6">
      <AdminPageHeader title={t("title")} />
      <Panel title={t("security")} id="security">
        <ActionForm action={saveSecurityAction}>
          <CheckboxField id="requireTotpForAllAdmins" name="requireTotpForAllAdmins" label={t("requireTotp")} hint={t("requireTotpHint")} defaultChecked={security.requireTotpForAllAdmins} />
          <SubmitButton>{tc("save")}</SubmitButton>
        </ActionForm>
      </Panel>
      <Panel title={t("email")} id="email">
        {email.config ? (
          <p className="text-sm">{t("emailReady", { domain: email.senderDomain ?? "" })}</p>
        ) : (
          <ul className="list-disc ps-5 text-sm text-danger" dir="ltr">
            {email.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <p className="mt-2 text-sm text-muted">{t("emailSenderNote")}</p>
        <div className="mt-3">
          <ActionForm action={sendTestEmailAction} errorNamespace="admin.settings" successText={t("emailTestSent")}>
            <SubmitButton variant="secondary">{t("emailTest")}</SubmitButton>
          </ActionForm>
        </div>
      </Panel>
      <Panel title={t("environment")} id="env">
        {/* Only non-secret facts are shown; secret values never leave the server. */}
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted">{t("siteUrl")}</dt><dd dir="ltr">{siteUrl}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">{t("outbound")}</dt><dd>{outboundOff ? t("outboundOff") : t("outboundOn")}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">{t("secretStatus")}</dt><dd>{env.APP_SECRET && env.APP_SECRET.length >= 32 ? tc("yes") : tc("no")}</dd></div>
          {integrations.map((i) => (
            <div key={i.key} className="flex justify-between gap-3">
              <dt className="text-muted">{t(`integration.${i.key}`)}</dt>
              <dd>{i.missing.length === 0 ? tc("yes") : <span>{tc("no")} <span className="text-xs text-muted" dir="ltr">({i.missing.join(", ")})</span></span>}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-muted">{t("secretsNote")}</p>
      </Panel>
    </div>
  );
}
