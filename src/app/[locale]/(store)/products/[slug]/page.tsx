import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { wishlistItems } from "@/server/db/schema";
import { getEnv, getSiteUrl } from "@/server/env";
import { getProductBySlug, getRelatedProducts } from "@/server/services/catalog";
import { isPurchasable } from "@/lib/pricing";
import { typeHasDigital } from "@/lib/domain";
import { formatBytes, mediaUrl, pick, pickText } from "@/lib/localize";
import { alternates } from "@/lib/seo";
import { ProductGrid } from "@/components/catalog/product-card";
import { ProductConfigurator } from "@/components/product/product-configurator";
import { ProductGallery } from "@/components/product/product-gallery";
import { WishlistButton } from "@/components/product/wishlist-button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { CashIcon, PrinterIcon, TruckIcon } from "@/components/ui/icons";
import { JsonLd } from "@/components/ui/json-ld";
import { Alert, Badge, Container } from "@/components/ui/misc";
import { Price } from "@/components/ui/price";

const SCHEMA_AVAILABILITY = {
  MADE_TO_ORDER: "https://schema.org/MadeToOrder",
  IN_STOCK: "https://schema.org/InStock",
  OUT_OF_STOCK: "https://schema.org/OutOfStock",
  PREORDER: "https://schema.org/PreOrder",
  DIGITAL: "https://schema.org/OnlineOnly",
} as const;

export async function generateMetadata({ params }: PageProps<"/[locale]/products/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const data = await getProductBySlug(await getDb(), slug);
  if (!data) return {};
  const p = data.product;
  const title = pick(locale, p.seoTitleEn, p.seoTitleAr) || pick(locale, p.nameEn, p.nameAr);
  const description = (pick(locale, p.seoDescriptionEn, p.seoDescriptionAr) || pick(locale, p.summaryEn, p.summaryAr) || pick(locale, p.descriptionEn, p.descriptionAr)).slice(0, 170);
  const image = data.images[0];
  return {
    title,
    description,
    alternates: alternates(locale, `/products/${slug}`),
    openGraph: {
      type: "website",
      title,
      description,
      url: `/${locale}/products/${slug}`,
      images: image ? [{ url: mediaUrl(image.r2Key), width: image.width ?? undefined, height: image.height ?? undefined, alt: pick(locale, image.altEn, image.altAr) }] : undefined,
    },
    twitter: { card: image ? "summary_large_image" : "summary", title, description },
  };
}

function Paragraphs({ text }: { text: string }) {
  // Descriptions are plain text (never HTML), rendered as paragraphs.
  return (
    <div className="space-y-3 text-text/90">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="whitespace-pre-line">
          {para}
        </p>
      ))}
    </div>
  );
}

export default async function ProductPage({ params }: PageProps<"/[locale]/products/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const db = await getDb();
  const data = await getProductBySlug(db, slug);
  if (!data) notFound();
  const { product: p, images, options, category, parentCategory, digitalFormats, price } = data;
  const [t, tc, ts, tcat, user, related, siteUrl, env] = await Promise.all([
    getTranslations("product"),
    getTranslations("common"),
    getTranslations("status"),
    getTranslations("catalog"),
    getCurrentUser(),
    getRelatedProducts(db, p.id, p.categoryId),
    getSiteUrl(),
    getEnv(),
  ]);
  const saved = user ? (await db.$count(wishlistItems, and(eq(wishlistItems.userId, user.id), eq(wishlistItems.productId, p.id)))) > 0 : false;
  const previewObject = p.previewModelKey ? await env.MEDIA.head(p.previewModelKey) : null;

  const name = pick(locale, p.nameEn, p.nameAr);
  const summary = pick(locale, p.summaryEn, p.summaryAr);
  const description = pick(locale, p.descriptionEn, p.descriptionAr);
  const purchasable = isPurchasable(p);
  const onSale = p.salePrice !== null && p.salePrice < p.basePrice;
  const productUrl = `${siteUrl}/${locale}/products/${p.slug}`;

  const crumbs = [
    { label: tc("home"), href: "/" },
    ...(parentCategory ? [{ label: pick(locale, parentCategory.nameEn, parentCategory.nameAr), href: `/categories/${parentCategory.slug}` }] : []),
    ...(category ? [{ label: pick(locale, category.nameEn, category.nameAr), href: `/categories/${category.slug}` }] : []),
    { label: name },
  ];

  const facts: [string, string][] = [];
  if (p.lengthMm && p.widthMm && p.heightMm) facts.push([t("dimensions"), t("dimensionsValue", { l: p.lengthMm, w: p.widthMm, h: p.heightMm })]);
  if (p.weightGrams) facts.push([t("weight"), t("weightValue", { grams: p.weightGrams })]);
  if (p.materials.length) facts.push([t("materials"), p.materials.join(", ")]);
  if (p.colors.length) facts.push([t("colors"), p.colors.join(locale === "ar" ? "، " : ", ")]);
  if (p.productionDaysMin !== null && p.productionDaysMax !== null && p.availability !== "DIGITAL") {
    facts.push([t("productionTime"), p.productionDaysMin === p.productionDaysMax ? t("productionSingle", { days: p.productionDaysMin }) : t("productionValue", { min: p.productionDaysMin, max: p.productionDaysMax })]);
  }
  if (digitalFormats.length) facts.push([t("digitalFormats"), digitalFormats.join(", ")]);

  return (
    <Container className="py-8 sm:py-10">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Product",
            name,
            description: summary || description.slice(0, 500),
            sku: p.slug,
            url: productUrl,
            image: images.map((i) => `${siteUrl}${mediaUrl(i.r2Key)}`),
            brand: { "@type": "Brand", name: "RoboNest.3D" },
            ...(category ? { category: pick(locale, category.nameEn, category.nameAr) } : {}),
            ...(p.materials.length ? { material: p.materials.join(", ") } : {}),
            offers: {
              "@type": "Offer",
              url: productUrl,
              priceCurrency: "IQD",
              price: String(price),
              availability: SCHEMA_AVAILABILITY[p.availability],
              itemCondition: "https://schema.org/NewCondition",
              seller: { "@type": "Organization", name: "RoboNest.3D" },
              ...(p.productType !== "DIGITAL"
                ? { shippingDetails: { "@type": "OfferShippingDetails", shippingDestination: { "@type": "DefinedRegion", addressCountry: "IQ" } } }
                : {}),
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: crumbs.map((c, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: c.label,
              ...(c.href ? { item: `${siteUrl}/${locale}${c.href === "/" ? "" : c.href}` } : { item: productUrl }),
            })),
          },
        ]}
      />
      <Breadcrumbs items={crumbs} />

      <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:gap-12">
        <ProductGallery
          name={name}
          images={images.map((i) => ({ src: mediaUrl(i.r2Key), alt: pick(locale, i.altEn, i.altAr) || name, width: i.width, height: i.height }))}
          previewSrc={p.previewModelKey ? mediaUrl(p.previewModelKey) : undefined}
          previewSize={previewObject ? formatBytes(previewObject.size, locale) : undefined}
        />

        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="primary">{ts(`productType.${p.productType}`)}</Badge>
              <Badge tone={purchasable ? "success" : "danger"}>{ts(`availability.${purchasable || p.availability !== "IN_STOCK" ? p.availability : "OUT_OF_STOCK"}`)}</Badge>
              {onSale ? <Badge tone="danger">{tcat("onSale")}</Badge> : null}
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
            {summary ? <p className="text-lg text-muted">{summary}</p> : null}
            <Price amount={price} compareAt={onSale ? p.basePrice : null} size="lg" />
            {p.availability === "IN_STOCK" && (p.stockQuantity ?? 0) > 0 ? <p className="text-sm text-success">{t("inStockCount", { count: p.stockQuantity ?? 0 })}</p> : null}
          </div>

          {purchasable ? (
            <ProductConfigurator
              productName={name}
              product={{ id: p.id, productType: p.productType, status: p.status, availability: p.availability, stockQuantity: p.stockQuantity, basePrice: p.basePrice, salePrice: p.salePrice }}
              options={options.map((o) => ({
                id: o.id,
                type: o.type,
                labelEn: o.labelEn,
                labelAr: o.labelAr,
                helpEn: o.helpEn,
                helpAr: o.helpAr,
                isRequired: o.isRequired,
                priceDelta: o.priceDelta,
                pricePerUnit: o.pricePerUnit,
                minValue: o.minValue,
                maxValue: o.maxValue,
                unitEn: o.unitEn,
                unitAr: o.unitAr,
                values: o.values.map((v) => ({ id: v.id, labelEn: v.labelEn, labelAr: v.labelAr, priceDelta: v.priceDelta, swatch: v.swatch })),
              }))}
            />
          ) : (
            <Alert tone="warning">{t("notAvailable")}</Alert>
          )}

          <WishlistButton productId={p.id} initialSaved={saved} signedIn={Boolean(user)} />

          {typeHasDigital(p.productType) ? <Alert tone="info">{t("digitalNote")}</Alert> : null}

          <ul className="grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-3">
            <li className="flex items-center gap-2">
              <CashIcon size={18} className="text-primary-text" />
              {t("cod")}
            </li>
            <li className="flex items-center gap-2">
              <TruckIcon size={18} className="text-primary-text" />
              {t("deliveryAll")}
            </li>
            <li className="flex items-center gap-2">
              <PrinterIcon size={18} className="text-primary-text" />
              {t("madeForYou")}
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="desc-title" className="space-y-6">
          <h2 id="desc-title" className="font-display text-2xl font-bold">
            {t("description")}
          </h2>
          {description ? <Paragraphs text={description} /> : null}
          {p.features.length ? (
            <div>
              <h3 className="mb-2 font-semibold">{t("features")}</h3>
              <ul className="list-inside list-disc space-y-1 text-text/90">
                {p.features.map((f, i) => (
                  <li key={i}>{pickText(locale, f)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.included.length ? (
            <div>
              <h3 className="mb-2 font-semibold">{t("included")}</h3>
              <ul className="list-inside list-disc space-y-1 text-text/90">
                {p.included.map((f, i) => (
                  <li key={i}>{pickText(locale, f)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        {facts.length || p.specifications.length ? (
          <section aria-labelledby="spec-title" className="space-y-4">
            <h2 id="spec-title" className="font-display text-2xl font-bold">
              {t("specifications")}
            </h2>
            <dl className="divide-y divide-border rounded-xl border border-border bg-surface">
              {[...facts, ...p.specifications.map((s) => [pickText(locale, s.label), pickText(locale, s.value)] as [string, string])].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 px-4 py-3 text-sm">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>

      {related.length ? (
        <section aria-labelledby="related-title" className="mt-16">
          <h2 id="related-title" className="mb-6 font-display text-2xl font-bold">
            {t("related")}
          </h2>
          <ProductGrid products={related} />
        </section>
      ) : null}
    </Container>
  );
}
