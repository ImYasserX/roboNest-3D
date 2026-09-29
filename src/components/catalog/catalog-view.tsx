import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/server/db/client";
import { getCategoryTree, getFacets, listProducts, type ProductQuery } from "@/server/services/catalog";
import { AVAILABILITY } from "@/lib/domain";
import { pick } from "@/lib/localize";
import { ButtonLink } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { SearchIcon, SlidersIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { AutoSubmitSelect } from "./auto-submit";
import { ProductGrid } from "./product-card";

type Props = {
  query: ProductQuery;
  /** Path (without locale) the filter form submits to. */
  basePath: string;
  /** Filters fixed by the page (e.g. category page, 3D models page); hidden from the form. */
  fixed?: Partial<Pick<ProductQuery, "category" | "type">>;
  showSearch?: boolean;
};

export async function CatalogView({ query, basePath, fixed = {}, showSearch = false }: Props) {
  const [t, ts, locale, db] = await Promise.all([getTranslations("catalog"), getTranslations("status"), getLocale(), getDb()]);
  const effective = { ...query, ...fixed };
  const [result, facets, tree] = await Promise.all([listProducts(db, effective), getFacets(db), getCategoryTree(db)]);
  const params: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(query)
      .filter(([k, v]) => v !== undefined && k !== "page" && !(k in fixed))
      .map(([k, v]) => [k, String(v)]),
  );
  const hasFilters = Object.keys(params).some((k) => k !== "sort" && k !== "q");
  const sortOptions = [
    ["relevance", t("sortRelevance")],
    ["newest", t("sortNewest")],
    ["price_asc", t("sortPriceAsc")],
    ["price_desc", t("sortPriceDesc")],
    ["popular", t("sortPopular")],
    ["best_selling", t("sortBestSelling")],
  ] as const;
  const action = `/${locale}${basePath}`;

  const filters = (
    <div className="space-y-5">
      {!fixed.category ? (
        <div className="space-y-1.5">
          <label htmlFor="f-category" className="block text-sm font-medium">
            {t("category")}
          </label>
          <select id="f-category" name="category" defaultValue={query.category ?? ""} className={controlClass}>
            <option value="">{t("allCategories")}</option>
            {tree.roots.map((root) => (
              <optgroup key={root.id} label={pick(locale, root.nameEn, root.nameAr)}>
                <option value={root.slug}>{pick(locale, root.nameEn, root.nameAr)} — {t("allCategories")}</option>
                {root.children.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {pick(locale, c.nameEn, c.nameAr)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      ) : null}
      {!fixed.type ? (
        <div className="space-y-1.5">
          <label htmlFor="f-type" className="block text-sm font-medium">
            {t("type")}
          </label>
          <select id="f-type" name="type" defaultValue={query.type ?? ""} className={controlClass}>
            <option value="">{t("allTypes")}</option>
            <option value="physical">{t("physicalOnly")}</option>
            <option value="digital">{t("digitalOnly")}</option>
            <option value="CUSTOMIZABLE">{ts("productType.CUSTOMIZABLE")}</option>
            <option value="CUSTOM_SERVICE">{ts("productType.CUSTOM_SERVICE")}</option>
          </select>
        </div>
      ) : null}
      {facets.materials.length > 0 ? (
        <div className="space-y-1.5">
          <label htmlFor="f-material" className="block text-sm font-medium">
            {t("material")}
          </label>
          <select id="f-material" name="material" defaultValue={query.material ?? ""} className={controlClass}>
            <option value="">{t("anyMaterial")}</option>
            {facets.materials.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="f-availability" className="block text-sm font-medium">
          {t("availability")}
        </label>
        <select id="f-availability" name="availability" defaultValue={query.availability ?? ""} className={controlClass}>
          <option value="">{t("anyAvailability")}</option>
          {AVAILABILITY.map((a) => (
            <option key={a} value={a}>
              {ts(`availability.${a}`)}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("price")}</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="f-min" className="sr-only">
              {t("minPrice")}
            </label>
            <input id="f-min" name="minPrice" type="number" inputMode="numeric" min={0} step={500} placeholder={String(facets.minPrice)} defaultValue={query.minPrice} className={controlClass} />
          </div>
          <div>
            <label htmlFor="f-max" className="sr-only">
              {t("maxPrice")}
            </label>
            <input id="f-max" name="maxPrice" type="number" inputMode="numeric" min={0} step={500} placeholder={String(facets.maxPrice)} defaultValue={query.maxPrice} className={controlClass} />
          </div>
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <input id="f-custom" name="customizable" value="1" type="checkbox" defaultChecked={query.customizable === "1"} className="size-5 accent-primary" />
        <label htmlFor="f-custom" className="text-sm">
          {t("customizableOnly")}
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="min-h-11 flex-1 rounded-md bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover">
          {t("applyFilters")}
        </button>
        {hasFilters ? (
          <ButtonLink href={basePath} variant="ghost">
            {t("clearFilters")}
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );

  return (
    <form action={action} method="get" className="grid gap-8 lg:grid-cols-[16rem_1fr]">
      {/* Filters: always visible on desktop, collapsible (native <details>) on mobile. */}
      <aside aria-label={t("filters")} className="lg:sticky lg:top-24 lg:self-start">
        <details className="group rounded-xl border border-border bg-surface p-4 lg:hidden">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 font-semibold">
            <SlidersIcon size={18} />
            {t("showFilters")}
          </summary>
          <div className="pt-4">{filters}</div>
        </details>
        <div className="hidden rounded-xl border border-border bg-surface p-5 lg:block">
          <h2 className="mb-4 font-display text-lg font-semibold">{t("filters")}</h2>
          {filters}
        </div>
      </aside>

      <div className="min-w-0 space-y-6">
        {showSearch ? (
          <div className="relative">
            <label htmlFor="q" className="sr-only">
              {t("searchLabel")}
            </label>
            <input id="q" name="q" type="search" maxLength={100} defaultValue={query.q} className={`${controlClass} h-12 ps-10`} />
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          </div>
        ) : query.q ? (
          <input type="hidden" name="q" value={query.q} />
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" role="status">
            {t("productCount", { count: result.total })}
          </p>
          <div className="flex items-center gap-2">
            <label htmlFor="sort" className="whitespace-nowrap text-sm text-muted">
              {t("sort")}
            </label>
            <AutoSubmitSelect id="sort" name="sort" defaultValue={result.sort ?? (query.q ? "relevance" : "newest")} className={`${controlClass} w-auto py-2`}>
              {sortOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </AutoSubmitSelect>
          </div>
        </div>
        {result.items.length > 0 ? (
          <ProductGrid products={result.items} headingLevel={2} />
        ) : (
          <EmptyState title={t("noResults")} description={t("noResultsHint")} action={hasFilters ? <ButtonLink href={basePath} variant="secondary">{t("clearFilters")}</ButtonLink> : undefined} />
        )}
        <Pagination page={result.page} pageCount={result.pageCount} pathname={basePath} searchParams={params} />
      </div>
    </form>
  );
}
