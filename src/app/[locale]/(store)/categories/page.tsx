import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/services/catalog";
import { categoryProductCounts } from "@/server/services/categories";
import { pick } from "@/lib/localize";
import { alternates } from "@/lib/seo";
import { ChevronIcon } from "@/components/ui/icons";
import { Container, PageHeader } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/categories">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "catalog" });
  return { title: t("categoriesTitle"), description: t("categoriesDescription"), alternates: alternates(locale, "/categories") };
}

export default async function CategoriesPage({ params }: PageProps<"/[locale]/categories">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("catalog");
  const db = await getDb();
  const [tree, counts] = await Promise.all([getCategoryTree(db), categoryProductCounts(db, { publishedOnly: true })]);
  const total = (ids: string[]) => ids.reduce((s, id) => s + (counts.get(id) ?? 0), 0);
  return (
    <Container className="space-y-10 py-10">
      <PageHeader title={t("categoriesTitle")} description={t("categoriesDescription")} />
      {tree.roots.map((root) => (
        <section key={root.id} aria-labelledby={`cat-${root.slug}`} className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <h2 id={`cat-${root.slug}`} className="font-display text-2xl font-bold">
              <Link href={`/categories/${root.slug}`} className="hover:underline">
                {pick(locale, root.nameEn, root.nameAr)}
              </Link>
            </h2>
            <span className="text-sm text-muted">{t("productsIn", { count: total([root.id, ...root.children.map((c) => c.id)]) })}</span>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {root.children.map((child) => (
              <li key={child.id}>
                <Link href={`/categories/${child.slug}`} className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4 hover:border-primary/60">
                  <span>
                    <span className="block font-semibold">{pick(locale, child.nameEn, child.nameAr)}</span>
                    <span className="text-sm text-muted">{t("productsIn", { count: counts.get(child.id) ?? 0 })}</span>
                  </span>
                  <ChevronIcon className="text-muted rtl:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Container>
  );
}
