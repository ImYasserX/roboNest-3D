import { getLocale, getTranslations } from "next-intl/server";
import { BUSINESS } from "@/lib/business";
import { formatIQD } from "@/lib/money";
import { DEPOSIT_THRESHOLD_IQD, FLAT_DELIVERY_FEE_IQD } from "@/lib/payment-rules";
import { Container, PageHeader } from "@/components/ui/misc";

type Section = { title: string; body: string | string[] };
export type ContentPageKey = "about" | "returns" | "privacy" | "terms" | "delivery" | "payment";

/** Fills {placeholders} in policy text with live business values (fees, thresholds). */
function fill(text: string, values: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
}

/**
 * Long-form content page driven by the `pages.<key>` translation namespace.
 * A section body may be one paragraph or a list of paragraphs. `updated`
 * shows when the text was last revised (a plain string in the messages).
 */
export async function ContentPage({ pageKey, children, before, values = {} }: { pageKey: ContentPageKey; children?: React.ReactNode; before?: React.ReactNode; values?: Record<string, string> }) {
  const [t, locale] = await Promise.all([getTranslations(`pages.${pageKey}`), getLocale()]);
  // Business facts come from code, never retyped in the policy text.
  const facts: Record<string, string> = {
    fee: formatIQD(FLAT_DELIVERY_FEE_IQD, locale),
    threshold: formatIQD(DEPOSIT_THRESHOLD_IQD, locale),
    email: BUSINESS.email,
    phones: BUSINESS.phones.map((p) => p.display).join(locale === "ar" ? " و " : " and "),
    hours: locale === "ar" ? BUSINESS.hours.ar : BUSINESS.hours.en,
    ...values,
  };
  const sections = t.raw("sections") as Section[];
  const updated = t.has("updated") ? (t.raw("updated") as string) : null;
  return (
    <Container className="max-w-4xl space-y-8 py-10">
      <PageHeader title={t("title")} description={t("description")} />
      {updated ? <p className="text-sm text-muted">{updated}</p> : null}
      {before}
      <div className="space-y-8">
        {sections.map((s) => (
          <section key={s.title} className="space-y-2">
            <h2 className="font-display text-xl font-semibold">{s.title}</h2>
            {(Array.isArray(s.body) ? s.body : [s.body]).map((p, i) => (
              <p key={i} className="leading-relaxed text-text/90">{fill(p, facts)}</p>
            ))}
          </section>
        ))}
      </div>
      {children}
    </Container>
  );
}

export async function contentMetadata(locale: string, pageKey: ContentPageKey, path: string) {
  const { alternates } = await import("@/lib/seo");
  const t = await getTranslations({ locale, namespace: `pages.${pageKey}` });
  return { title: t("title"), description: t("description"), alternates: alternates(locale, path), openGraph: { title: t("title"), description: t("description"), url: `/${locale}${path}` } };
}
