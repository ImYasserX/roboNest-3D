import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { readVerifyCookie } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { describeChallenge } from "@/server/services/phone-verification";
import { getPhoneVerifiers } from "@/server/sms";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { VerifyCodeForm } from "@/components/account/auth-forms";
import { ButtonLink } from "@/components/ui/button";
import { Card, Container } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/verify-phone">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("verifyTitle"), robots: { index: false } };
}

export default async function VerifyPhonePage({ params, searchParams }: PageProps<"/[locale]/verify-phone">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  const next = safeRedirectPath((await searchParams).next, "/account");
  const [challenge, verifiers] = await Promise.all([describeChallenge(await getDb(), await readVerifyCookie()), getPhoneVerifiers()]);
  const smsFallback = challenge?.channel === "WHATSAPP" && Boolean(verifiers?.byChannel.SMS);
  return (
    <Container className="max-w-md py-12">
      <Card className="space-y-5 p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold">{t("verifyTitle")}</h1>
        {challenge && challenge.purpose !== "RESET" ? (
          <VerifyCodeForm next={next} maskedPhone={challenge.maskedPhone} channel={challenge.channel} smsFallback={smsFallback} />
        ) : (
          <>
            <p className="text-muted">{t("verifyExpired")}</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/register">{t("register")}</ButtonLink>
              <ButtonLink href="/login" variant="outline">{t("signIn")}</ButtonLink>
            </div>
          </>
        )}
      </Card>
    </Container>
  );
}
