import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireCustomerPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listOrdersForUser } from "@/server/services/orders";
import { formatIraqiPhone } from "@/lib/phone";
import { OrdersTable } from "@/components/account/orders-table";
import { ProfileForm } from "@/components/account/auth-forms";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("title"), robots: { index: false } };
}

export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCustomerPage(locale, "/account");
  const t = await getTranslations("account");
  const orders = await listOrdersForUser(await getDb(), user.id, 5);
  return (
    <div className="space-y-10">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <section aria-labelledby="recent" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="recent" className="font-display text-xl font-semibold">{t("recentOrders")}</h2>
          {orders.length ? <ButtonLink href="/account/orders" variant="ghost" size="sm">{t("orders")}</ButtonLink> : null}
        </div>
        {orders.length ? <OrdersTable rows={orders} /> : <EmptyState title={t("noOrders")} description={t("noOrdersText")} />}
      </section>
      <section aria-labelledby="profile" className="space-y-4">
        <h2 id="profile" className="font-display text-xl font-semibold">{t("profile")}</h2>
        <Card className="max-w-lg space-y-4 p-5">
          <p className="text-sm text-muted">
            {t("phone")}: <span className="ltr-nums text-text">{formatIraqiPhone(user.phone)}</span>
          </p>
          <ProfileForm name={user.name} locale={user.locale} />
        </Card>
      </section>
    </div>
  );
}
