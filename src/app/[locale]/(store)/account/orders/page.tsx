import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireCustomerPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listOrdersForUser } from "@/server/services/orders";
import { OrdersTable } from "@/components/account/orders-table";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/orders">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("orders"), robots: { index: false } };
}

export default async function AccountOrdersPage({ params }: PageProps<"/[locale]/account/orders">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCustomerPage(locale, "/account/orders");
  const [t, tc] = await Promise.all([getTranslations("account"), getTranslations("cart")]);
  const orders = await listOrdersForUser(await getDb(), user.id);
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">{t("orders")}</h1>
      {orders.length ? <OrdersTable rows={orders} /> : <EmptyState title={t("noOrders")} description={t("noOrdersText")} action={<ButtonLink href="/products">{tc("continue")}</ButtonLink>} />}
    </div>
  );
}
