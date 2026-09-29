import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/server/db/client";
import { listDeliveryZones } from "@/server/services/delivery";
import { formatIQD } from "@/lib/money";
import { pick } from "@/lib/localize";
import { ContentPage, contentMetadata } from "@/components/layout/content-page";

export async function generateMetadata({ params }: PageProps<"/[locale]/delivery">): Promise<Metadata> {
  const { locale } = await params;
  return contentMetadata(locale, "delivery", "/delivery");
}

export default async function DeliveryPage({ params }: PageProps<"/[locale]/delivery">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tc] = await Promise.all([getTranslations("pages.delivery"), getTranslations("common")]);
  const zones = await listDeliveryZones(await getDb(), { activeOnly: true });
  return (
    <ContentPage
      pageKey="delivery"
      before={
        <div className="space-y-4">
          <p className="text-text/90">{t("intro")}</p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[32rem] text-sm">
              <caption className="sr-only">{t("tableCaption")}</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("governorate")}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("fee")}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("eta")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {zones.map((z) => (
                  <tr key={z.id}>
                    <th scope="row" className="px-4 py-3 text-start font-medium">
                      {pick(locale, z.nameEn, z.nameAr)}
                      {z.areas.length ? (
                        <ul className="mt-1 space-y-0.5 text-xs font-normal text-muted">
                          {z.areas.map((a) => (
                            <li key={a.id}>
                              {pick(locale, a.nameEn, a.nameAr)}: <span className="ltr-nums">{formatIQD(a.fee, locale)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </th>
                    <td className="ltr-nums px-4 py-3">{formatIQD(z.fee, locale)}</td>
                    <td className="px-4 py-3">{tc("daysRange", { min: z.etaDaysMin, max: z.etaDaysMax })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  );
}
