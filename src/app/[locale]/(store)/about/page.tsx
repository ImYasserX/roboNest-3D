import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ContentPage, contentMetadata } from "@/components/layout/content-page";

export async function generateMetadata({ params }: PageProps<"/[locale]/about">): Promise<Metadata> {
  const { locale } = await params;
  return contentMetadata(locale, "about", "/about");
}

export default async function AboutPage({ params }: PageProps<"/[locale]/about">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContentPage pageKey="about" />;
}
