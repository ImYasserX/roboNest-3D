import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getProductCardsByIds } from "@/server/services/catalog";
import { wishlistProductIds } from "@/server/services/engagement";
import { ProductGrid } from "@/components/catalog/product-card";
import { ButtonLink } from "@/components/ui/button";
import { HeartIcon } from "@/components/ui/icons";
import { Container, EmptyState, PageHeader } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/wishlist">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "wishlist" });
  return { title: t("title"), robots: { index: false } };
}

export default async function WishlistPage({ params }: PageProps<"/[locale]/wishlist">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, ta, tp, tauth, tc] = await Promise.all([getTranslations("wishlist"), getTranslations("account"), getTranslations("product"), getTranslations("auth"), getTranslations("cart")]);
  const user = await getCurrentUser();
  const db = await getDb();
  const products = user ? await getProductCardsByIds(db, await wishlistProductIds(db, user.id)) : [];
  return (
    <Container className="space-y-8 py-10">
      <PageHeader title={t("title")} description={t("description")} />
      {!user ? (
        <EmptyState icon={<HeartIcon size={40} />} title={tp("saveSignIn")} action={<ButtonLink href="/login?next=/wishlist">{tauth("signIn")}</ButtonLink>} />
      ) : products.length === 0 ? (
        <EmptyState icon={<HeartIcon size={40} />} title={ta("noWishlist")} description={ta("noWishlistText")} action={<ButtonLink href="/products">{tc("continue")}</ButtonLink>} />
      ) : (
        <ProductGrid products={products} headingLevel={2} />
      )}
    </Container>
  );
}
