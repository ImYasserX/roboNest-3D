import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/server/auth/current";
import { AdminLoginForm } from "@/components/admin/auth-forms";
import { Card } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/login">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.login" });
  return { title: t("title") };
}

export default async function AdminLoginPage({ params }: PageProps<"/[locale]/admin/login">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAdminSession();
  if (session?.stage === "ACTIVE") redirect(`/${locale}/admin`);
  const t = await getTranslations("admin.login");
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-5 p-6 sm:p-8">
        <div className="space-y-1">
          <p className="font-display text-lg font-extrabold" dir="ltr">RoboNest<span className="text-primary-text">.3D</span></p>
          <h1 className="font-display text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted">{t("text")}</p>
        </div>
        <AdminLoginForm />
      </Card>
    </main>
  );
}
