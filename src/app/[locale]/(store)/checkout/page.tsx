import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { getCartOwner } from "@/server/cart-owner";
import { getDb } from "@/server/db/client";
import { addresses } from "@/server/db/schema";
import { getCartView } from "@/server/services/cart";
import { listDeliveryZones } from "@/server/services/delivery";
import { formatIraqiPhone } from "@/lib/phone";
import { CartLines } from "@/components/cart/cart-lines";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Container, PageHeader } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/checkout">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "checkout" });
  return { title: t("title"), robots: { index: false } };
}

export default async function CheckoutPage({ params }: PageProps<"/[locale]/checkout">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, ta, to, db, user] = await Promise.all([getTranslations("checkout"), getTranslations("auth"), getTranslations("order"), getDb(), getCurrentUser()]);
  const cart = await getCartView(db, await getCartOwner({ create: false }));
  if (cart.lines.length === 0 || !cart.isValid) redirect({ href: "/cart", locale });

  if (cart.hasDigital && !user) {
    return (
      <Container className="space-y-6 py-10">
        <PageHeader title={t("title")} />
        <Alert tone="info" title={t("signInForDigital")} />
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/login?next=/checkout">{ta("signIn")}</ButtonLink>
          <ButtonLink href="/register?next=/checkout" variant="outline">
            {ta("createOne")}
          </ButtonLink>
        </div>
      </Container>
    );
  }

  const zones = await listDeliveryZones(db, { activeOnly: true });
  const saved = user ? (await db.select().from(addresses).where(eq(addresses.userId, user.id)).orderBy(desc(addresses.isDefault), desc(addresses.updatedAt)).limit(1))[0] : undefined;

  return (
    <Container className="space-y-8 py-10">
      <PageHeader title={t("title")} description={user ? undefined : t("signInOptional")} />
      <CheckoutForm
        // A fresh key per page render: double clicks, retries and refresh-resubmits map to one order.
        idempotencyKey={crypto.randomUUID()}
        zones={zones.map((z) => ({ id: z.id, nameEn: z.nameEn, nameAr: z.nameAr, fee: z.fee, etaDaysMin: z.etaDaysMin, etaDaysMax: z.etaDaysMax, areas: z.areas.map((a) => ({ id: a.id, nameEn: a.nameEn, nameAr: a.nameAr, fee: a.fee })) }))}
        subtotal={cart.subtotal}
        hasPhysical={cart.hasPhysical}
        hasDigital={cart.hasDigital}
        signedIn={Boolean(user)}
        initial={{
          fullName: saved?.fullName ?? user?.name ?? "",
          phone: saved?.phone ? formatIraqiPhone(saved.phone) : user ? formatIraqiPhone(user.phone) : "",
          zoneId: saved?.zoneId ?? "",
          areaId: saved?.areaId ?? "",
          city: saved?.city ?? "",
          district: saved?.district ?? "",
          addressLine: saved?.addressLine ?? "",
          landmark: saved?.landmark ?? "",
        }}
      />
      <section aria-labelledby="checkout-items" className="space-y-3">
        <h2 id="checkout-items" className="font-display text-lg font-semibold">
          {to("items")}
        </h2>
        <CartLines lines={cart.lines} editable={false} />
      </section>
    </Container>
  );
}
