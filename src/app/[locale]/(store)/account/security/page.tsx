import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireCustomerPage } from "@/server/auth/current";
import { ChangePasswordForm } from "@/components/account/auth-forms";
import { Card } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/security">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("security"), robots: { index: false } };
}

export default async function SecurityPage({ params }: PageProps<"/[locale]/account/security">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireCustomerPage(locale, "/account/security");
  const t = await getTranslations("account");
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">{t("security")}</h1>
      <Card className="max-w-lg p-5">
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
