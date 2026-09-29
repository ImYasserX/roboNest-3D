import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternates } from "@/lib/seo";
import { JsonLd } from "@/components/ui/json-ld";
import { Container, PageHeader } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/faq">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.faq" });
  return { title: t("title"), description: t("description"), alternates: alternates(locale, "/faq") };
}

export default async function FaqPage({ params }: PageProps<"/[locale]/faq">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.faq");
  const items = t.raw("items") as { q: string; a: string }[];
  return (
    <Container className="max-w-3xl space-y-8 py-10">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
        }}
      />
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-3">
        {items.map((item) => (
          <details key={item.q} className="group rounded-xl border border-border bg-surface open:border-primary/50">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-semibold">
              <h2 className="text-base">{item.q}</h2>
              <span aria-hidden="true" className="text-xl text-primary-text transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="px-5 pb-5 text-text/90">{item.a}</p>
          </details>
        ))}
      </div>
    </Container>
  );
}
