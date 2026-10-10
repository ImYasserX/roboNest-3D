import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { readVerifyCookie } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { describeChallenge } from "@/server/services/phone-verification";
import { getSetting } from "@/server/services/settings";
import { getPhoneVerifiers } from "@/server/sms";
import { whatsappLink } from "@/lib/phone";
import { alternates } from "@/lib/seo";
import { ForgotPhoneForm, NewPasswordWithCodeForm, VerifyCodeForm } from "@/components/account/auth-forms";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { WhatsappIcon } from "@/components/ui/icons";
import { Card, Container } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/forgot-password">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("forgotTitle"), alternates: alternates(locale, "/forgot-password"), robots: { index: false } };
}

export default async function ForgotPasswordPage({ params }: PageProps<"/[locale]/forgot-password">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tn] = await Promise.all([getTranslations("auth"), getTranslations("nav")]);
  const db = await getDb();
  const [verifiers, challenge, store] = await Promise.all([getPhoneVerifiers(), describeChallenge(db, await readVerifyCookie()), getSetting(db, "store")]);
  const verifier = verifiers?.primary ?? null;
  const resetChallenge = challenge?.purpose === "RESET" ? challenge : null;
  return (
    <Container className="max-w-md py-12">
      <Card className="space-y-5 p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold">{t("forgotTitle")}</h1>
        {verifier ? (
          resetChallenge?.codeAccepted ? (
            <NewPasswordWithCodeForm />
          ) : resetChallenge ? (
            <VerifyCodeForm maskedPhone={resetChallenge.maskedPhone} channel={resetChallenge.channel} smsFallback={resetChallenge.channel === "WHATSAPP" && Boolean(verifiers?.byChannel.SMS)} />
          ) : (
            <>
              <p className="text-muted">{t("forgotSmsText")}</p>
              <ForgotPhoneForm />
            </>
          )
        ) : (
          <>
            {/* No SMS provider yet: staff verify the customer and send a one-time link. */}
            <p className="text-muted">{t("forgotText")}</p>
            {store.whatsapp ? (
              <a href={whatsappLink(store.whatsapp, t("forgotMessage"))} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "lg", "w-full")}>
                <WhatsappIcon /> {t("forgotCta")}
              </a>
            ) : (
              <ButtonLink href="/contact" size="lg" className="w-full">
                {tn("contact")}
              </ButtonLink>
            )}
          </>
        )}
      </Card>
    </Container>
  );
}
