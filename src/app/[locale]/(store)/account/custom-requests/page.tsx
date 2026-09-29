import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireCustomerPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listCustomRequestsForUser } from "@/server/services/custom-print";
import { formatIQD } from "@/lib/money";
import { formatDate } from "@/lib/localize";
import { Link } from "@/i18n/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/custom-requests">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("customRequests"), robots: { index: false } };
}

export default async function CustomRequestsPage({ params }: PageProps<"/[locale]/account/custom-requests">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCustomerPage(locale, "/account/custom-requests");
  const [t, ts, tcu, lang] = await Promise.all([getTranslations("account"), getTranslations("status"), getTranslations("custom"), getLocale()]);
  const rows = await listCustomRequestsForUser(await getDb(), user.id);
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">{t("customRequests")}</h1>
      {rows.length === 0 ? (
        <EmptyState title={t("noRequests")} description={t("noRequestsText")} action={<ButtonLink href="/custom-printing">{tcu("formTitle")}</ButtonLink>} />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.requestNumber}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <Link href={`/custom-printing/requests/${r.requestNumber}`} className="ltr-nums font-semibold text-primary-text underline">
                    {r.requestNumber}
                  </Link>
                  <p className="text-sm text-muted">{formatDate(r.createdAt, lang)} · {r.material} · ×{r.quantity}</p>
                </div>
                <div className="flex items-center gap-3">
                  {r.quotedPrice && r.status !== "SUBMITTED" && r.status !== "IN_REVIEW" ? <span className="ltr-nums font-semibold">{formatIQD(r.quotedPrice, lang)}</span> : null}
                  <Badge tone={r.status === "QUOTED" ? "warning" : r.status === "ACCEPTED" ? "success" : r.status === "REJECTED" ? "danger" : "neutral"}>{ts(`customRequest.${r.status}`)}</Badge>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
