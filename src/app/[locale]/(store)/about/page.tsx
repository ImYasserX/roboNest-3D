import type { Metadata } from "next";
import Image from "next/image";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/server/db/client";
import { getHomeCollections } from "@/server/services/catalog";
import { BUSINESS, businessWhatsappUrl } from "@/lib/business";
import { mediaUrl, pick, pickText } from "@/lib/localize";
import { contentFacts, contentMetadata, fill, type ContentSection } from "@/components/layout/content-page";
import { HeroVisual } from "@/components/layout/hero-visual";
import { Link } from "@/i18n/navigation";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { CubeIcon, DownloadIcon, PrinterIcon, UploadIcon, WhatsappIcon } from "@/components/ui/icons";
import { Card, Container } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/about">): Promise<Metadata> {
  const { locale } = await params;
  return contentMetadata(locale, "about", "/about");
}

/**
 * About page in the storefront's own visual language (blueprint hero, cards,
 * brand purple accents). Text comes from pages.about in the messages; it is
 * not extended with claims the business has not made.
 */
export default async function AboutPage({ params }: PageProps<"/[locale]/about">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, ta, tn, lang] = await Promise.all([getTranslations("pages.about"), getTranslations("about"), getTranslations("nav"), getLocale()]);
  const sections = t.raw("sections") as ContentSection[];
  const facts = contentFacts(lang);
  const text = (s: ContentSection) => (Array.isArray(s.body) ? s.body : [s.body]).map((p) => fill(p, facts));
  const [who, how, custom, digital] = sections;
  // Real catalog imagery only (whatever is published); nothing is staged.
  const showcase = (await getHomeCollections(await getDb())).featured.filter((p) => p.image).slice(0, 4);
  const pillars = [
    { icon: PrinterIcon, section: how, href: "/products" },
    { icon: UploadIcon, section: custom, href: "/custom-printing" },
    { icon: DownloadIcon, section: digital, href: "/models" },
  ].filter((p) => p.section);

  return (
    <>
      {/* Introduction */}
      <section aria-labelledby="about-title" className="bg-blueprint relative overflow-hidden border-b border-border">
        <Container className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-5">
            <p className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary-soft px-3 py-1 text-xs font-semibold text-primary-text">
              <CubeIcon size={14} />
              {ta("eyebrow")}
            </p>
            <h1 id="about-title" className="font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              {t("title")}
            </h1>
            <p className="max-w-xl text-lg text-muted">{t("description")}</p>
            <div className="flex flex-wrap gap-3 pt-2">
              <ButtonLink href="/products" size="lg">{ta("ctaModels")}</ButtonLink>
              <ButtonLink href="/custom-printing" size="lg" variant="outline">{ta("ctaCustom")}</ButtonLink>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroVisual />
          </div>
        </Container>
      </section>

      {/* Who we are */}
      {who ? (
        <section aria-labelledby="about-who" className="py-14 sm:py-20">
          <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <div className="space-y-3">
              <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-primary-text">{ta("studioLabel")}</p>
              <h2 id="about-who" className="font-display text-3xl font-bold tracking-tight">{who.title}</h2>
              <div aria-hidden="true" className="h-1 w-16 rounded-full bg-primary" />
            </div>
            <div className="max-w-prose space-y-4 text-lg leading-relaxed text-text/90">
              {text(who).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </Container>
        </section>
      ) : null}

      {/* How we work: one card per approved section */}
      {pillars.length ? (
        <section aria-labelledby="about-how" className="border-y border-border bg-surface py-14 sm:py-20">
          <Container className="space-y-8">
            <h2 id="about-how" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{ta("pillarsTitle")}</h2>
            <ol className="grid gap-5 md:grid-cols-3">
              {pillars.map(({ icon: Icon, section, href }, i) => (
                <li key={section.title}>
                  <Card className="group flex h-full flex-col gap-4 bg-bg p-6 shadow-card transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/60 motion-reduce:transform-none">
                    <div className="flex items-center justify-between">
                      <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-lg bg-primary-soft text-primary-text">
                        <Icon size={22} />
                      </span>
                      <span aria-hidden="true" className="ltr-nums font-display text-3xl font-extrabold text-primary-text/70">{String(i + 1).padStart(2, "0")}</span>
                    </div>
                    <h3 className="font-display text-xl font-semibold">{section.title}</h3>
                    <div className="flex-1 space-y-2 text-muted">
                      {text(section).map((p, j) => <p key={j}>{p}</p>)}
                    </div>
                    <Link href={href} className="inline-flex min-h-11 w-fit items-center font-semibold text-primary-text underline-offset-4 hover:underline">
                      {ta(`pillarLink${i + 1}` as "pillarLink1")}
                    </Link>
                  </Card>
                </li>
              ))}
            </ol>
          </Container>
        </section>
      ) : null}

      {/* From the workshop: published products only */}
      {showcase.length ? (
        <section aria-labelledby="about-work" className="py-14 sm:py-20">
          <Container className="space-y-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h2 id="about-work" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{ta("workTitle")}</h2>
              <Link href="/products" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-text hover:underline">{ta("ctaModels")}</Link>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {showcase.map((p) => (
                <li key={p.id}>
                  <Link href={`/products/${p.slug}`} className="group block overflow-hidden rounded-xl border border-border bg-surface-2 focus-visible:shadow-glow">
                    <span className="relative block aspect-square overflow-hidden">
                      <Image src={mediaUrl(p.image!.key)} alt={pick(lang, p.image!.altEn, p.image!.altAr) || pick(lang, p.nameEn, p.nameAr)} fill sizes="(min-width: 1024px) 22vw, 45vw" className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
                    </span>
                    <span className="block p-3 text-sm font-medium">{pick(lang, p.nameEn, p.nameAr)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      ) : null}

      {/* Contact */}
      <section aria-labelledby="about-contact" className="pb-6">
        <Container>
          <div className="bg-blueprint grid gap-8 rounded-2xl border border-border bg-surface p-6 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-3">
              <h2 id="about-contact" className="font-display text-2xl font-bold sm:text-3xl">{ta("contactTitle")}</h2>
              <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">{ta("email")}</dt><dd><a href={`mailto:${BUSINESS.email}`} className="font-semibold underline-offset-4 hover:underline" dir="ltr">{BUSINESS.email}</a></dd></div>
                <div>
                  <dt className="text-muted">{ta("phones")}</dt>
                  <dd className="flex flex-wrap gap-x-3">{BUSINESS.phones.map((p) => <a key={p.tel} href={`tel:${p.tel}`} className="ltr-nums font-semibold underline-offset-4 hover:underline">{p.display}</a>)}</dd>
                </div>
                <div><dt className="text-muted">{ta("hours")}</dt><dd className="font-semibold">{pickText(lang, BUSINESS.hours)}</dd></div>
              </dl>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={businessWhatsappUrl()} target="_blank" rel="noopener noreferrer" aria-label={tn("whatsappChat", { number: BUSINESS.whatsapp.display })} className={buttonClass("primary", "lg")}>
                <WhatsappIcon size={18} /> WhatsApp
              </a>
              <ButtonLink href="/contact" size="lg" variant="outline">{tn("contact")}</ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
