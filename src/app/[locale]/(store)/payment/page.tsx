import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatIQD } from "@/lib/money";
import { DEPOSIT_THRESHOLD_IQD } from "@/lib/payment-rules";
import { ContentPage, contentMetadata } from "@/components/layout/content-page";

export async function generateMetadata({ params }: PageProps<"/[locale]/payment">): Promise<Metadata> {
  const { locale } = await params;
  return contentMetadata(locale, "payment", "/payment");
}

export default async function PaymentPolicyPage({ params }: PageProps<"/[locale]/payment">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.payment");
  return (
    <ContentPage
      pageKey="payment"
      before={<p className="rounded-xl border border-primary/40 bg-primary-soft p-4 font-semibold">{t("summary", { threshold: formatIQD(DEPOSIT_THRESHOLD_IQD, locale) })}</p>}
    />
  );
}
