import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/server/db/client";
import { getSiteUrl } from "@/server/env";
import { getHomeCollections } from "@/server/services/catalog";
import { listDeliveryZones } from "@/server/services/delivery";
import { getSettings } from "@/server/services/settings";
import { pickText } from "@/lib/localize";
import { formatIQD } from "@/lib/money";
import { ProductGrid } from "@/components/catalog/product-card";
import { HeroVisual } from "@/components/layout/hero-visual";
import { Section } from "@/components/layout/section";
import { ButtonLink } from "@/components/ui/button";
import { CashIcon, CheckIcon, CubeIcon, PrinterIcon, ShieldIcon, SlidersIcon, TruckIcon, UploadIcon, WhatsappIcon, WrenchIcon } from "@/components/ui/icons";
import { Container, EmptyState } from "@/components/ui/misc";
import { JsonLd } from "@/components/ui/json-ld";
import { alternates } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: { absolute: t("defaultTitle") },
    description: t("defaultDescription"),
    alternates: alternates(locale, ""),
    openGraph: { title: t("defaultTitle"), description: t("defaultDescription"), url: `/${locale}` },
  };
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tm, tc] = await Promise.all([getTranslations("home"), getTranslations("meta"), getTranslations("catalog")]);
  const db = await getDb();
  const [collections, zones, settings, siteUrl] = await Promise.all([
    getHomeCollections(db),
    listDeliveryZones(db, { activeOnly: true }),
    getSettings(db, ["homepage", "store"]),
    getSiteUrl(),
  ]);
  const minFee = zones.length ? Math.min(...zones.map((z) => z.fee)) : null;
  const hasCatalog = collections.latest.length > 0;

  const how = [
    { icon: UploadIcon, title: t("how1Title"), text: t("how1Text") },
    { icon: PrinterIcon, title: t("how2Title"), text: t("how2Text") },
    { icon: TruckIcon, title: t("how3Title"), text: t("how3Text") },
    { icon: CashIcon, title: t("how4Title"), text: t("how4Text") },
  ];
  const why = [
    { icon: WrenchIcon, title: t("why1Title"), text: t("why1Text") },
    { icon: SlidersIcon, title: t("why2Title"), text: t("why2Text") },
    { icon: ShieldIcon, title: t("why3Title"), text: t("why3Text") },
    { icon: WhatsappIcon, title: t("why4Title"), text: t("why4Text") },
  ];

  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "RoboNest.3D",
            url: siteUrl,
            logo: `${siteUrl}/brand/robonest-mark-256.png`,
            parentOrganization: { "@type": "Organization", name: "RoboNest" },
            areaServed: { "@type": "Country", name: "Iraq" },
            ...(settings.store.phone ? { telephone: settings.store.phone } : {}),
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "RoboNest.3D",
            url: `${siteUrl}/${locale}`,
            inLanguage: locale === "ar" ? "ar-IQ" : "en",
            potentialAction: {
              "@type": "SearchAction",
              target: { "@type": "EntryPoint", urlTemplate: `${siteUrl}/${locale}/search?q={search_term_string}` },
              "query-input": "required name=search_term_string",
            },
          },
        ]}
      />

      {/* Hero */}
      <section aria-labelledby="hero-title" className="bg-blueprint relative overflow-hidden border-b border-border">
        <Container className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.15fr_1fr]">
          <div className="space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary-soft px-3 py-1 text-xs font-semibold text-primary-text">
              <CubeIcon size={14} />
              {t("heroEyebrow")}
            </p>
            <h1 id="hero-title" className="font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              {pickText(locale, settings.homepage.heroTitle)}
            </h1>
            <p className="max-w-xl text-lg text-muted">{pickText(locale, settings.homepage.heroSubtitle)}</p>
            <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-primary-text">{tm("tagline")}</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/products" size="lg">
                {t("ctaShop")}
              </ButtonLink>
              <ButtonLink href="/custom-printing" size="lg" variant="outline">
                {t("ctaCustom")}
              </ButtonLink>
            </div>
            <dl className="grid gap-4 pt-4 sm:grid-cols-3">
              {[
                [t("heroStat1"), t("heroStat1Detail")],
                [t("heroStat2"), t("heroStat2Detail")],
                [t("heroStat3"), t("heroStat3Detail")],
              ].map(([term, detail]) => (
                <div key={term} className="border-s-2 border-primary ps-3">
                  <dt className="font-semibold">{term}</dt>
                  <dd className="text-sm text-muted">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroVisual />
          </div>
        </Container>
      </section>

      {!hasCatalog ? (
        <Container className="py-16">
          <EmptyState title={t("emptyCatalog")} icon={<CubeIcon size={40} />} />
        </Container>
      ) : null}

      {collections.featured.length > 0 ? (
        <Section id="featured" title={t("featured")} description={t("featuredDescription")} href="/products" hrefLabel={t("ctaShop")}>
          <ProductGrid products={collections.featured.slice(0, 4)} />
        </Section>
      ) : null}

      {/* How it works */}
      <Section id="how" title={t("howTitle")} className="border-y border-border bg-surface py-14 sm:py-20">
        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {how.map((step, i) => (
            <li key={step.title} className="relative rounded-xl border border-border bg-bg p-5">
              <span className="ltr-nums absolute end-4 top-4 font-display text-3xl font-extrabold text-primary-text" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <step.icon size={28} className="mb-4 text-primary-text" />
              <h3 className="font-display text-lg font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {collections.latest.length > 0 ? (
        <Section id="latest" title={t("latest")} description={t("latestDescription")} href="/products?sort=newest" hrefLabel={t("ctaShop")}>
          <ProductGrid products={collections.latest.slice(0, 4)} />
        </Section>
      ) : null}

      {/* Custom printing */}
      <section aria-labelledby="custom-title" className="py-14 sm:py-20">
        <Container>
          <div className="grid gap-8 overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-br from-primary-soft to-transparent p-6 sm:p-10 lg:grid-cols-2">
            <div className="space-y-4">
              <h2 id="custom-title" className="font-display text-2xl font-bold sm:text-3xl">
                {t("customTitle")}
              </h2>
              <p className="text-muted">{t("customDescription")}</p>
              <ButtonLink href="/custom-printing" size="lg">
                {t("customCta")}
              </ButtonLink>
            </div>
            <ul className="space-y-3 self-center">
              {[t("customPoint1"), t("customPoint2"), t("customPoint3")].map((point) => (
                <li key={point} className="flex items-center gap-3 rounded-lg bg-bg/60 p-4">
                  <CheckIcon className="shrink-0 text-success" />
                  <span className="font-medium">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {collections.popular.length > 0 ? (
        <Section id="popular" title={t("popular")} description={t("popularDescription")} href="/products?sort=popular" hrefLabel={t("ctaShop")}>
          <ProductGrid products={collections.popular.slice(0, 4)} />
        </Section>
      ) : null}

      {collections.models.length > 0 ? (
        <Section id="models" title={t("models")} description={t("modelsDescription")} href="/models" hrefLabel={t("modelsCta")}>
          <ProductGrid products={collections.models} />
        </Section>
      ) : null}

      {/* Why */}
      <Section id="why" title={t("whyTitle")} className="border-y border-border bg-surface py-14 sm:py-20">
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {why.map((item) => (
            <li key={item.title} className="space-y-2">
              <item.icon size={28} className="text-primary-text" />
              <h3 className="font-display text-lg font-semibold">{item.title}</h3>
              <p className="text-sm text-muted">{item.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* Delivery */}
      <section aria-labelledby="delivery-title" className="py-14 sm:py-20">
        <Container className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <h2 id="delivery-title" className="flex items-center gap-3 font-display text-2xl font-bold sm:text-3xl">
              <TruckIcon size={30} className="text-primary-text" />
              {t("deliveryTitle")}
            </h2>
            <p className="max-w-2xl text-muted">{t("deliveryText")}</p>
            {minFee !== null ? (
              <p className="text-sm">
                <span className="text-muted">{tc("from")} </span>
                <span className="ltr-nums font-semibold">{formatIQD(minFee, locale)}</span>
              </p>
            ) : null}
          </div>
          <ButtonLink href="/delivery" variant="secondary" size="lg">
            {t("deliveryCta")}
          </ButtonLink>
        </Container>
      </section>

      {/* CTA */}
      <section aria-labelledby="cta-title" className="pb-6">
        <Container>
          <div className="bg-blueprint flex flex-col items-start gap-5 rounded-2xl border border-border bg-surface p-8 sm:flex-row sm:items-center sm:justify-between sm:p-12">
            <div>
              <h2 id="cta-title" className="font-display text-2xl font-bold sm:text-3xl">
                {t("ctaTitle")}
              </h2>
              <p className="mt-2 text-muted">{t("ctaText")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/products" size="lg">
                {t("ctaShop")}
              </ButtonLink>
              <ButtonLink href="/custom-printing" size="lg" variant="outline">
                {t("ctaCustom")}
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
