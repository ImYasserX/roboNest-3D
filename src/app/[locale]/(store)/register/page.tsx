import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { alternates } from "@/lib/seo";
import { Link } from "@/i18n/navigation";
import { RegisterForm } from "@/components/account/auth-forms";
import { Alert, Card, Container } from "@/components/ui/misc";
import { getPhoneVerifier } from "@/server/sms";

export async function generateMetadata({ params }: PageProps<"/[locale]/register">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("registerTitle"), alternates: alternates(locale, "/register"), robots: { index: false } };
}

export default async function RegisterPage({ params, searchParams }: PageProps<"/[locale]/register">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const next = safeRedirectPath((await searchParams).next, "/account");
  if (await getCurrentUser()) redirect(`/${locale}/account`);
  const t = await getTranslations("auth");
  // Accounts require a verified phone; without an SMS provider nobody can register.
  const smsReady = (await getPhoneVerifier()) !== null;
  return (
    <Container className="max-w-md py-12">
      <Card className="space-y-6 p-6 sm:p-8">
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold">{t("registerTitle")}</h1>
          <p className="text-muted">{t("registerText")}</p>
        </div>
        {smsReady ? <RegisterForm next={next} /> : <Alert tone="warning" title={t("registrationUnavailableTitle")}>{t("registrationUnavailableText")}</Alert>}
        <p className="border-t border-border pt-4 text-sm text-muted">
          {t("haveAccount")}{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-primary-text underline">
            {t("signIn")}
          </Link>
        </p>
      </Card>
    </Container>
  );
}
