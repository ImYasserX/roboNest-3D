import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current";
import { getCartOwner } from "@/server/cart-owner";
import { getDb } from "@/server/db/client";
import { getCartView } from "@/server/services/cart";
import { formatIQD } from "@/lib/money";
import { CartLines } from "@/components/cart/cart-lines";
import { ButtonLink } from "@/components/ui/button";
import { CartIcon } from "@/components/ui/icons";
import { Alert, Container, EmptyState, PageHeader } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/cart">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "cart" });
  return { title: t("title"), robots: { index: false } };
}

export default async function CartPage({ params }: PageProps<"/[locale]/cart">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, db, user] = await Promise.all([getTranslations("cart"), getDb(), getCurrentUser()]);
  const cart = await getCartView(db, await getCartOwner({ create: false }));
  const lang = await getLocale();

  return (
    <Container className="space-y-8 py-10">
      <PageHeader title={t("title")} />
      {cart.lines.length === 0 ? (
        <EmptyState icon={<CartIcon size={40} />} title={t("empty")} description={t("emptyText")} action={<ButtonLink href="/products">{t("continue")}</ButtonLink>} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
          <section aria-label={t("item")} className="space-y-4">
            {!cart.isValid ? <Alert tone="danger">{t("fixProblems")}</Alert> : null}
            <CartLines lines={cart.lines} />
            <ButtonLink href="/products" variant="ghost">
              {t("continue")}
            </ButtonLink>
          </section>
          <aside aria-labelledby="summary-title" className="h-fit space-y-4 rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-24">
            <h2 id="summary-title" className="font-display text-lg font-semibold">
              {t("summary")}
            </h2>
            <div className="flex justify-between text-base">
              <span>{t("subtotal")}</span>
              <span className="ltr-nums font-bold">{formatIQD(cart.subtotal, lang)}</span>
            </div>
            <p className="text-sm text-muted">{t("deliveryAtCheckout")}</p>
            {cart.hasDigital && !user ? <Alert tone="info">{t("digitalNeedsAccount")}</Alert> : null}
            {cart.isValid ? (
              <ButtonLink href="/checkout" size="lg" className="w-full">
                {t("checkout")}
              </ButtonLink>
            ) : (
              <p className="text-sm text-danger">{t("fixProblems")}</p>
            )}
            <p className="text-xs text-muted">{t("priceNote")}</p>
          </aside>
        </div>
      )}
    </Container>
  );
}
