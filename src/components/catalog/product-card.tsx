import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ProductCard as ProductCardData } from "@/server/services/catalog";
import { mediaUrl, pick } from "@/lib/localize";
import { Badge } from "@/components/ui/misc";
import { CubeIcon } from "@/components/ui/icons";
import { Price } from "@/components/ui/price";

export function ProductCard({ product, headingLevel = 3 }: { product: ProductCardData; headingLevel?: 2 | 3 }) {
  const locale = useLocale();
  const t = useTranslations();
  const name = pick(locale, product.nameEn, product.nameAr);
  const summary = pick(locale, product.summaryEn, product.summaryAr);
  const alt = product.image ? pick(locale, product.image.altEn, product.image.altAr) || name : "";
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const onSale = product.salePrice !== null && product.salePrice < product.basePrice;
  const unavailable = product.availability === "OUT_OF_STOCK" || (product.availability === "IN_STOCK" && (product.stockQuantity ?? 0) <= 0);

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-primary/60">
      <div className="relative aspect-square overflow-hidden bg-surface-2">
        {product.image ? (
          <Image
            src={mediaUrl(product.image.key)}
            alt={alt}
            fill
            sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 50vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            <CubeIcon size={48} />
            <span className="sr-only">{t("product.noImage")}</span>
          </div>
        )}
        <div className="absolute start-2 top-2 flex flex-wrap gap-1.5">
          {onSale ? <Badge tone="danger">{t("catalog.onSale")}</Badge> : null}
          {product.productType === "DIGITAL" || product.productType === "PHYSICAL_DIGITAL" ? (
            <Badge tone="info">{t(`status.productType.${product.productType}`)}</Badge>
          ) : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Heading className="font-display text-base font-semibold leading-snug">
          {/* The stretched link makes the whole card clickable with one tab stop. */}
          <Link href={`/products/${product.slug}`} className="after:absolute after:inset-0 after:content-['']">
            {name}
          </Link>
        </Heading>
        {summary ? <p className="line-clamp-2 text-sm text-muted">{summary}</p> : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <Price amount={product.price} compareAt={onSale ? product.basePrice : null} />
          <span className={unavailable ? "text-xs font-medium text-danger" : "text-xs text-muted"}>
            {t(`status.availability.${unavailable ? "OUT_OF_STOCK" : product.availability}`)}
          </span>
        </div>
        {product.isCustomizable || product.hasPreview ? (
          <div className="flex flex-wrap gap-1.5">
            {product.isCustomizable ? <Badge tone="primary">{t("catalog.customizable")}</Badge> : null}
            {product.hasPreview ? <Badge>{t("catalog.preview3d")}</Badge> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ProductGrid({ products, headingLevel }: { products: ProductCardData[]; headingLevel?: 2 | 3 }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
      {products.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}
