import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { alternates } from "@/lib/seo";
import { Link } from "@/i18n/navigation";
import { LoginForm } from "@/components/account/auth-forms";
import { Card, Container } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/login">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("signInTitle"), alternates: alternates(locale, "/login"), robots: { index: false } };
}

export default async function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const next = safeRedirectPath((await searchParams).next, "/account");
  if (await getCurrentUser()) redirect(/^\/(ar|en)(\/|$)/.test(next) ? next : `/${locale}${next}`);
  const t = await getTranslations("auth");
  return (
    <Container className="max-w-md py-12">
      <Card className="space-y-6 p-6 sm:p-8">
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold">{t("signInTitle")}</h1>
          <p className="text-muted">{t("signInText")}</p>
        </div>
        <LoginForm next={next} />
        <p className="border-t border-border pt-4 text-sm text-muted">
          {t("noAccount")}{" "}
          <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-primary-text underline">
            {t("createOne")}
          </Link>
        </p>
        <p className="text-sm text-muted">{t("guestNote")}</p>
      </Card>
    </Container>
  );
}
