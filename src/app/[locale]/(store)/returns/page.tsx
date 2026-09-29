import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ContentPage, contentMetadata } from "@/components/layout/content-page";

export async function generateMetadata({ params }: PageProps<"/[locale]/returns">): Promise<Metadata> {
  const { locale } = await params;
  return contentMetadata(locale, "returns", "/returns");
}

export default async function ReturnsPage({ params }: PageProps<"/[locale]/returns">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContentPage pageKey="returns" />;
}
