import { getTranslations } from "next-intl/server";
import { Container, PageHeader } from "@/components/ui/misc";

type Section = { title: string; body: string };

/** Long-form content page driven by the `pages.<key>` translation namespace. */
export async function ContentPage({ pageKey, children, before }: { pageKey: "about" | "returns" | "privacy" | "terms" | "delivery"; children?: React.ReactNode; before?: React.ReactNode }) {
  const t = await getTranslations(`pages.${pageKey}`);
  const sections = t.raw("sections") as Section[];
  return (
    <Container className="max-w-4xl space-y-8 py-10">
      <PageHeader title={t("title")} description={t("description")} />
      {before}
      <div className="space-y-8">
        {sections.map((s) => (
          <section key={s.title} className="space-y-2">
            <h2 className="font-display text-xl font-semibold">{s.title}</h2>
            <p className="leading-relaxed text-text/90">{s.body}</p>
          </section>
        ))}
      </div>
      {children}
    </Container>
  );
}

export async function contentMetadata(locale: string, pageKey: string, path: string) {
  const { alternates } = await import("@/lib/seo");
  const t = await getTranslations({ locale, namespace: `pages.${pageKey}` });
  return { title: t("title"), description: t("description"), alternates: alternates(locale, path), openGraph: { title: t("title"), description: t("description"), url: `/${locale}${path}` } };
}
