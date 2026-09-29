import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getOrderByAccessToken, getOrderForUser } from "@/server/services/orders";
import { getSetting } from "@/server/services/settings";
import { OrderView } from "@/components/order/order-view";
import { ButtonLink } from "@/components/ui/button";
import { Container, EmptyState } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/orders/[number]">): Promise<Metadata> {
  const { locale, number } = await params;
  const t = await getTranslations({ locale, namespace: "order" });
  // Order pages are private: never indexed, never sent as a referrer.
  return { title: t("title", { number }), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function OrderPage({ params, searchParams }: PageProps<"/[locale]/orders/[number]">) {
  const { locale, number } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t : null;
  const db = await getDb();
  const user = await getCurrentUser();
  // Access requires either the secret link token or ownership by the signed-in customer.
  const order = (token ? await getOrderByAccessToken(db, number, token) : null) ?? (user ? await getOrderForUser(db, number, user.id) : null);
  const t = await getTranslations("order");

  if (!order) {
    return (
      <Container className="py-16">
        <EmptyState title={t("notFoundTitle")} description={t("notFoundText")} action={<ButtonLink href="/track">{t("trackTitle")}</ButtonLink>} />
      </Container>
    );
  }
  const store = await getSetting(db, "store");
  // Set only by the checkout redirect (?new=1) so the thank-you banner shows once.
  const justPlaced = sp.new === "1" && order.status === "PENDING";
  return (
    <Container className="py-10">
      <OrderView order={order} whatsapp={store.whatsapp} justPlaced={justPlaced} />
    </Container>
  );
}
