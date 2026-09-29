import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getSetting } from "@/server/services/settings";
import { roleRequiresTotp } from "@/lib/permissions";
import { AdminPasswordForm, TotpSetup } from "@/components/admin/auth-forms";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { Alert } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/security">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.security" });
  return { title: t("title") };
}

export default async function AdminSecurityPage({ params, searchParams }: PageProps<"/[locale]/admin/security">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, undefined, { allowEnrollment: true });
  const t = await getTranslations("admin.security");
  const security = await getSetting(await getDb(), "security");
  const required = roleRequiresTotp(admin.role) || security.requireTotpForAllAdmins;
  const justEnabled = (await searchParams).enabled === "1";
  return (
    <div className="max-w-3xl space-y-6">
      <AdminPageHeader title={t("title")} />
      {required && !admin.totpEnabled ? <Alert tone="warning">{t("totpRequired")}</Alert> : null}
      <Panel title={t("totpTitle")} id="totp">
        {justEnabled ? <Alert tone="success" className="mb-4">{t("enabled")}</Alert> : null}
        {admin.totpEnabled ? <Alert tone="success">{t("totpEnabled")}</Alert> : <div className="space-y-3"><p className="text-sm text-muted">{t("totpOff")}</p><TotpSetup /></div>}
      </Panel>
      <Panel title={t("passwordTitle")} id="pw">
        <AdminPasswordForm />
      </Panel>
    </div>
  );
}
