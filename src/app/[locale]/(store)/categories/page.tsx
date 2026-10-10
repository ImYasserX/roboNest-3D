import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/server/db/client";
import { getCategoryShowcase } from "@/server/services/categories";
import { mediaUrl, pick } from "@/lib/localize";
import { alternates } from "@/lib/seo";
import { ChevronIcon, CubeIcon } from "@/components/ui/icons";
import { Container, EmptyState, PageHeader } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";

export async function generateMetadata({ params }: PageProps<"/[locale]/categories">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "catalog" });
  return { title: t("categoriesTitle"), description: t("categoriesDescription"), alternates: alternates(locale, "/categories") };
}

export default async function CategoriesPage({ params }: PageProps<"/[locale]/categories">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("catalog");
  const showcase = await getCategoryShowcase(await getDb());

  return (
    <Container className="space-y-12 py-10">
      <PageHeader title={t("categoriesTitle")} description={t("categoriesDescription")} />
      {showcase.length === 0 ? (
        <EmptyState icon={<CubeIcon size={40} />} title={t("categoriesEmpty")} action={<ButtonLink href="/products">{t("browseAll")}</ButtonLink>} />
      ) : null}
      {showcase.map((root, index) => {
        const name = pick(locale, root.nameEn, root.nameAr);
        const description = pick(locale, root.descriptionEn, root.descriptionAr);
        return (
          <section key={root.id} aria-labelledby={`cat-${root.slug}`} className="space-y-5">
            {/* Feature card for the top-level category: real product image, real count. */}
            <Link
              href={`/categories/${root.slug}`}
              className="category-card group relative grid overflow-hidden rounded-2xl border border-border bg-surface shadow-card transition-[box-shadow,border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-glow focus-visible:shadow-glow motion-reduce:transform-none md:grid-cols-[1.1fr_1fr]"
            >
              <div className={`relative z-10 flex flex-col justify-center gap-3 p-6 sm:p-8 ${index % 2 === 1 ? "md:order-2" : ""}`}>
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/40 bg-primary-soft px-3 py-1 text-xs font-semibold text-primary-text">
                  <CubeIcon size={14} />
                  {t("productsIn", { count: root.productCount })}
                </span>
                <h2 id={`cat-${root.slug}`} className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                  {name}
                </h2>
                {description ? <p className="max-w-md text-muted">{description}</p> : null}
                <span className="inline-flex items-center gap-1.5 font-semibold text-primary-text">
                  {t("shopCategory", { name })}
                  <ChevronIcon size={18} className="transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
                </span>
              </div>
              <div className="category-media bg-blueprint relative aspect-[16/10] overflow-hidden bg-surface-2 md:aspect-auto md:min-h-64">
                {root.image ? (
                  <Image src={mediaUrl(root.image.key)} alt={pick(locale, root.image.altEn, root.image.altAr)} fill sizes="(min-width: 768px) 45vw, 100vw" className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-primary-text/60">
                    <CubeIcon size={72} />
                  </div>
                )}
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface/70 via-transparent to-transparent md:bg-gradient-to-r md:from-surface md:via-surface/10 rtl:md:bg-gradient-to-l" />
              </div>
            </Link>

            {root.children.length ? (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("subcategoriesOf", { name })}>
                {root.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/categories/${child.slug}`}
                      className="group flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:bg-surface-2 motion-reduce:transform-none"
                    >
                      <span className="flex items-center gap-3">
                        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-text">
                          <CubeIcon size={18} />
                        </span>
                        <span>
                          <span className="block font-semibold">{pick(locale, child.nameEn, child.nameAr)}</span>
                          <span className="text-sm text-muted">{child.productCount > 0 ? t("productsIn", { count: child.productCount }) : t("comingSoon")}</span>
                        </span>
                      </span>
                      <ChevronIcon className="text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary-text rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </Container>
  );
}
