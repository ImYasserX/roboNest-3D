import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Container } from "@/components/ui/misc";
import { contentFacts, fill, type ContentPageKey, type ContentSection } from "./content-page";

/**
 * Long-form policy layout (used by Terms): blueprint header, a table of
 * contents (sticky on desktop, collapsible on mobile), numbered sections in
 * cards and a readable line length. Text comes unchanged from pages.<key>.
 */
export async function PolicyPage({ pageKey }: { pageKey: ContentPageKey }) {
  const [t, tp, locale] = await Promise.all([getTranslations(`pages.${pageKey}`), getTranslations("policy"), getLocale()]);
  const sections = t.raw("sections") as ContentSection[];
  const facts = contentFacts(locale);
  const anchor = (i: number) => `section-${i + 1}`;
  const num = (i: number) => (locale === "ar" ? (i + 1).toLocaleString("ar-IQ") : String(i + 1));

  const toc = (
    <ol className="space-y-1 text-sm">
      {sections.map((s, i) => (
        <li key={s.title}>
          <a href={`#${anchor(i)}`} className="flex min-h-9 items-center gap-2 rounded-md px-2 text-muted hover:bg-surface-2 hover:text-text">
            <span className="ltr-nums w-5 shrink-0 text-xs font-semibold text-primary-text">{num(i)}</span>
            <span>{s.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <header className="bg-blueprint border-b border-border">
        <Container className="max-w-6xl space-y-3 py-12 sm:py-16">
          <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-primary-text">{tp("eyebrow")}</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{t("title")}</h1>
          <p className="max-w-2xl text-lg text-muted">{t("description")}</p>
        </Container>
      </header>

      <Container className="grid max-w-6xl gap-8 py-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label={tp("contents")} className="lg:sticky lg:top-32 lg:self-start">
          <details className="rounded-xl border border-border bg-surface p-3 lg:hidden">
            <summary className="min-h-10 cursor-pointer list-none px-2 py-2 font-semibold">{tp("contents")}</summary>
            <div className="mt-2">{toc}</div>
          </details>
          <div className="hidden lg:block">
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted">{tp("contents")}</p>
            {toc}
          </div>
        </nav>

        <div className="min-w-0 space-y-5">
          {sections.map((s, i) => (
            <section key={s.title} id={anchor(i)} aria-labelledby={`${anchor(i)}-title`} className="scroll-mt-32 rounded-xl border border-border bg-surface p-5 sm:p-7">
              <h2 id={`${anchor(i)}-title`} className="flex items-baseline gap-3 font-display text-xl font-semibold">
                <span aria-hidden="true" className="ltr-nums flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-sm font-bold text-primary-text">{num(i)}</span>
                <span>{s.title}</span>
              </h2>
              <div className="mt-3 max-w-prose space-y-3 ps-11 leading-relaxed text-text/90">
                {(Array.isArray(s.body) ? s.body : [s.body]).map((p, j) => <p key={j}>{fill(p, facts)}</p>)}
              </div>
            </section>
          ))}
          <p className="ps-1 text-sm text-muted">
            {tp.rich("related", {
              privacy: (c) => <Link href="/privacy" className="underline">{c}</Link>,
              payment: (c) => <Link href="/payment" className="underline">{c}</Link>,
              returns: (c) => <Link href="/returns" className="underline">{c}</Link>,
              delivery: (c) => <Link href="/delivery" className="underline">{c}</Link>,
            })}
          </p>
        </div>
      </Container>
    </>
  );
}
