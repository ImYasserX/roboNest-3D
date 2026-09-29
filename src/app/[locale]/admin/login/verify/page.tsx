import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/server/auth/current";
import { Link } from "@/i18n/navigation";
import { AdminVerifyForm } from "@/components/admin/auth-forms";
import { Card } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/login/verify">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.login" });
  return { title: t("verifyTitle") };
}

export default async function AdminVerifyPage({ params }: PageProps<"/[locale]/admin/login/verify">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAdminSession();
  if (!session) redirect(`/${locale}/admin/login`);
  if (session.stage === "ACTIVE") redirect(`/${locale}/admin`);
  const t = await getTranslations("admin.login");
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-5 p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold">{t("verifyTitle")}</h1>
        <p className="text-sm text-muted">{t("verifyText")}</p>
        <AdminVerifyForm />
        <Link href="/admin/login" className="text-sm text-primary-text underline">{t("startOver")}</Link>
      </Card>
    </main>
  );
}
