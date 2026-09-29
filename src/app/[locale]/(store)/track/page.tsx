import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternates } from "@/lib/seo";
import { TrackForm } from "@/components/order/track-form";
import { Card, Container, PageHeader } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/track">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "order" });
  return { title: t("trackTitle"), description: t("trackText"), alternates: alternates(locale, "/track") };
}

export default async function TrackPage({ params }: PageProps<"/[locale]/track">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("order");
  return (
    <Container className="max-w-xl space-y-8 py-10">
      <PageHeader title={t("trackTitle")} description={t("trackText")} />
      <Card className="p-6">
        <TrackForm />
      </Card>
    </Container>
  );
}
