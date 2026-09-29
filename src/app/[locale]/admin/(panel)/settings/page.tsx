import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getEnv, getSiteUrl } from "@/server/env";
import { saveSecurityAction } from "@/server/actions/admin/manage";
import { getSetting } from "@/server/services/settings";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { CheckboxField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/settings">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.settings" }))("title") };
}

export default async function SettingsPage({ params }: PageProps<"/[locale]/admin/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "settings.edit");
  const [t, tc] = await Promise.all([getTranslations("admin.settings"), getTranslations("admin.common")]);
  const [security, siteUrl, env] = await Promise.all([getSetting(await getDb(), "security"), getSiteUrl(), getEnv()]);
  return (
    <div className="max-w-3xl space-y-6">
      <AdminPageHeader title={t("title")} />
      <Panel title={t("security")} id="security">
        <ActionForm action={saveSecurityAction}>
          <CheckboxField id="requireTotpForAllAdmins" name="requireTotpForAllAdmins" label={t("requireTotp")} hint={t("requireTotpHint")} defaultChecked={security.requireTotpForAllAdmins} />
          <SubmitButton>{tc("save")}</SubmitButton>
        </ActionForm>
      </Panel>
      <Panel title={t("environment")} id="env">
        {/* Only non-secret facts are shown; secret values never leave the server. */}
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted">{t("siteUrl")}</dt><dd dir="ltr">{siteUrl}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">{t("secretStatus")}</dt><dd>{env.APP_SECRET && env.APP_SECRET.length >= 32 ? tc("yes") : tc("no")}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-muted">{t("secretsNote")}</p>
      </Panel>
    </div>
  );
}
