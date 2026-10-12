import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { contentMetadata } from "@/components/layout/content-page";
import { PolicyPage } from "@/components/layout/policy-page";

export async function generateMetadata({ params }: PageProps<"/[locale]/terms">): Promise<Metadata> {
  const { locale } = await params;
  return contentMetadata(locale, "terms", "/terms");
}

export default async function TermsPage({ params }: PageProps<"/[locale]/terms">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PolicyPage pageKey="terms" />;
}
