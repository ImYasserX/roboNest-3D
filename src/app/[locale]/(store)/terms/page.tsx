import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ContentPage, contentMetadata } from "@/components/layout/content-page";

export async function generateMetadata({ params }: PageProps<"/[locale]/terms">): Promise<Metadata> {
  const { locale } = await params;
  return contentMetadata(locale, "terms", "/terms");
}

export default async function TermsPage({ params }: PageProps<"/[locale]/terms">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContentPage pageKey="terms" />;
}
