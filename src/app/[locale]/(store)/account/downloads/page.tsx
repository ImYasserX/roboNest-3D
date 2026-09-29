import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireCustomerPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listEntitlements } from "@/server/services/downloads";
import { formatBytes, pick } from "@/lib/localize";
import { buttonClass } from "@/components/ui/button";
import { DownloadIcon } from "@/components/ui/icons";
import { Badge, Card, EmptyState } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/downloads">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("downloads"), robots: { index: false } };
}

export default async function DownloadsPage({ params, searchParams }: PageProps<"/[locale]/account/downloads">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCustomerPage(locale, "/account/downloads");
  const [t, lang] = await Promise.all([getTranslations("account"), getLocale()]);
  const items = await listEntitlements(await getDb(), user.id);
  const error = (await searchParams).error;
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">{t("downloads")}</h1>
      {typeof error === "string" && ["not_found", "unpaid", "limit_reached"].includes(error) ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm">{t(`errors.${error}`)}</p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState icon={<DownloadIcon size={40} />} title={t("noDownloads")} description={t("noDownloadsText")} />
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.orderItemId}>
              <Card className="space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">{pick(lang, item.productNameEn, item.productNameAr)}</h2>
                  <span className="ltr-nums text-sm text-muted">{item.orderNumber}</span>
                </div>
                {!item.unlocked ? (
                  <Badge tone="warning">{t("awaitingPayment")}</Badge>
                ) : item.remaining === 0 ? (
                  <Badge tone="danger">{t("limitReached")}</Badge>
                ) : item.files.length === 0 ? (
                  <p className="text-sm text-muted">{t("noFiles")}</p>
                ) : (
                  <>
                    <ul className="flex flex-wrap gap-2">
                      {item.files.map((f) => (
                        <li key={f.id}>
                          {/* Plain link to an authorization-checked route; the file itself is private. */}
                          <a href={`/api/downloads/${item.orderItemId}/${f.id}`} className={buttonClass("secondary", "md")} download>
                            <DownloadIcon size={18} />
                            {t("download", { file: f.filename })}
                            <span className="text-xs text-muted">({f.format} · {formatBytes(f.sizeBytes, lang)})</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted">{t("downloadsLeft", { count: item.remaining })}</p>
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
