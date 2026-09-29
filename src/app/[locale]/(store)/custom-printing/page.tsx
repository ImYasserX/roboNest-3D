import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getSetting } from "@/server/services/settings";
import { formatIraqiPhone } from "@/lib/phone";
import { alternates } from "@/lib/seo";
import { CustomPrintForm } from "@/components/custom/custom-print-form";
import { Card, Container, PageHeader } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/custom-printing">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "custom" });
  return { title: t("title"), description: t("description"), alternates: alternates(locale, "/custom-printing"), openGraph: { title: t("title"), description: t("description"), url: `/${locale}/custom-printing` } };
}

export default async function CustomPrintingPage({ params }: PageProps<"/[locale]/custom-printing">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("custom");
  const [offer, user] = await Promise.all([getSetting(await getDb(), "customPrint"), getCurrentUser()]);
  return (
    <Container className="space-y-10 py-10">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
        <Card as="section" aria-labelledby="form-title" className="space-y-6 p-5 sm:p-8">
          <h2 id="form-title" className="font-display text-2xl font-bold">{t("formTitle")}</h2>
          <CustomPrintForm materials={offer.materials} colors={offer.colors} initialName={user?.name ?? ""} initialPhone={user ? formatIraqiPhone(user.phone) : ""} />
        </Card>
        <aside aria-labelledby="process-title" className="space-y-4">
          <h2 id="process-title" className="font-display text-xl font-semibold">{t("process")}</h2>
          <ol className="space-y-3">
            {[t("step1"), t("step2"), t("step3"), t("step4")].map((step, i) => (
              <li key={step} className="flex gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
                <span className="ltr-nums flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary-text" aria-hidden="true">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </Container>
  );
}
