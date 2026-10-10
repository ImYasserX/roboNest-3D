import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireCustomerPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getOrderForUser } from "@/server/services/orders";
import { enabledDepositMethods } from "@/server/services/deposits";
import { latestOnlinePayment } from "@/server/services/online-deposits";
import { getDepositProvider } from "@/server/payments";
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
  const [store, depositMethods, provider, latest] = await Promise.all([getSetting(db, "store"), enabledDepositMethods(db, locale), getDepositProvider(), latestOnlinePayment(db, order.id)]);
  const online = { available: provider !== null, payment: latest ? { status: latest.status, payInfo: latest.payInfo, open: latest.open } : null };
  return <OrderView order={order} whatsapp={store.whatsapp} token={null} depositMethods={depositMethods} online={online} />;
}
