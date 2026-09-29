import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireCustomerPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getOrderForUser } from "@/server/services/orders";
import { getSetting } from "@/server/services/settings";
import { OrderView } from "@/components/order/order-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/orders/[number]">): Promise<Metadata> {
  const { locale, number } = await params;
  const t = await getTranslations({ locale, namespace: "order" });
  return { title: t("title", { number }), robots: { index: false } };
}

export default async function AccountOrderPage({ params }: PageProps<"/[locale]/account/orders/[number]">) {
  const { locale, number } = await params;
  setRequestLocale(locale);
  const user = await requireCustomerPage(locale, `/account/orders/${number}`);
  const db = await getDb();
  // Ownership check: another customer's order number yields 404, not the order.
  const order = await getOrderForUser(db, number, user.id);
  if (!order) notFound();
  const store = await getSetting(db, "store");
  return <OrderView order={order} whatsapp={store.whatsapp} />;
}
