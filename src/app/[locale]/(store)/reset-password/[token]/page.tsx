import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/server/db/client";
import { isResetTokenValid } from "@/server/services/customer-auth";
import { ResetPasswordForm } from "@/components/account/auth-forms";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Card, Container } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/reset-password/[token]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  // The token is a secret: keep it out of indexes and Referer headers.
  return { title: t("resetTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function ResetPasswordPage({ params }: PageProps<"/[locale]/reset-password/[token]">) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  const valid = await isResetTokenValid(await getDb(), token);
  return (
    <Container className="max-w-md py-12">
      <Card className="space-y-5 p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold">{t("resetTitle")}</h1>
        {valid ? (
          <>
            <p className="text-muted">{t("resetText")}</p>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <>
            <Alert tone="danger">{t("resetInvalid")}</Alert>
            <ButtonLink href="/forgot-password" variant="secondary">
              {t("forgotTitle")}
            </ButtonLink>
          </>
        )}
      </Card>
    </Container>
  );
}
