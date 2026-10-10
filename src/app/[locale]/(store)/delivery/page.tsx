import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/server/db/client";
import { listDeliveryZones } from "@/server/services/delivery";
import { formatIQD } from "@/lib/money";
import { FLAT_DELIVERY_FEE_IQD } from "@/lib/payment-rules";
import { pick } from "@/lib/localize";
import { ContentPage, contentMetadata } from "@/components/layout/content-page";

export async function generateMetadata({ params }: PageProps<"/[locale]/delivery">): Promise<Metadata> {
  const { locale } = await params;
  return contentMetadata(locale, "delivery", "/delivery");
}

export default async function DeliveryPage({ params }: PageProps<"/[locale]/delivery">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.delivery");
  const zones = await listDeliveryZones(await getDb(), { activeOnly: true });
  return (
    <ContentPage
      pageKey="delivery"
      before={
        <div className="space-y-4">
          <p className="rounded-xl border border-primary/40 bg-primary-soft p-4 text-lg font-semibold">
            {t("flatFee", { fee: formatIQD(FLAT_DELIVERY_FEE_IQD, locale) })}
          </p>
          <p className="text-text/90">{t("intro")}</p>
          {zones.length ? (
            <div className="space-y-2">
              <h2 className="font-display text-xl font-semibold">{t("locationsTitle")}</h2>
              <ul className="flex flex-wrap gap-2" aria-label={t("locationsTitle")}>
                {zones.map((z) => (
                  <li key={z.id} className="rounded-full border border-border bg-surface px-3 py-1 text-sm">
                    {pick(locale, z.nameEn, z.nameAr)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      }
    />
  );
}
