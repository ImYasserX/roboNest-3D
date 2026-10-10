import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { orders } from "@/server/db/schema";
import { getAppSecret } from "@/server/env";
import { getCustomRequestForCustomer } from "@/server/services/custom-print";
import { listDeliveryZones } from "@/server/services/delivery";
import { orderAccessToken } from "@/server/services/orders";
import { formatIQD } from "@/lib/money";
import { formatBytes, formatDate } from "@/lib/localize";
import { QuoteResponse } from "@/components/custom/quote-response";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Badge, Card, Container, EmptyState } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/custom-printing/requests/[number]">): Promise<Metadata> {
  const { locale, number } = await params;
  const t = await getTranslations({ locale, namespace: "custom" });
  return { title: t("requestTitle", { number }), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function CustomRequestPage({ params, searchParams }: PageProps<"/[locale]/custom-printing/requests/[number]">) {
  const { locale, number } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const token = sp.t;
  const tokenStr = typeof token === "string" ? token : null;
  const [t, ts, tc, db, user] = await Promise.all([getTranslations("custom"), getTranslations("status"), getTranslations("common"), getDb(), getCurrentUser()]);
  const request = await getCustomRequestForCustomer(db, number, { userId: user?.id, token: tokenStr });
  if (!request) {
    return (
      <Container className="py-16">
        <EmptyState title={t("errors.not_found")} action={<ButtonLink href="/custom-printing">{t("formTitle")}</ButtonLink>} />
      </Container>
    );
  }
  const isFresh = sp.new === "1" && request.status === "SUBMITTED";
  let orderLink: string | null = null;
  if (request.status === "ACCEPTED" && request.orderId) {
    const [o] = await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, request.orderId)).limit(1);
    if (o) orderLink = `/orders/${o.orderNumber}?t=${await orderAccessToken(await getAppSecret(), request.orderId)}`;
  }
  const zones = request.status === "QUOTED" ? await listDeliveryZones(db, { activeOnly: true }) : [];

  return (
    <Container className="max-w-4xl space-y-8 py-10">
      {isFresh ? (
        <Alert tone="success" title={t("submittedTitle")}>
          <p>{t("submittedText", { number: request.requestNumber })}</p>
          <p className="text-muted">{t("keepLink")}</p>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-6">
        <h1 className="font-display text-3xl font-bold">
          {t("requestTitle", { number: "" })}
          <span className="ltr-nums">{request.requestNumber}</span>
        </h1>
        <Badge tone={request.status === "QUOTED" ? "warning" : request.status === "ACCEPTED" ? "success" : request.status === "REJECTED" ? "danger" : "primary"}>{ts(`customRequest.${request.status}`)}</Badge>
      </div>

      {request.status === "SUBMITTED" || request.status === "IN_REVIEW" ? <Alert tone="info">{t("waiting")}</Alert> : null}
      {request.status === "REJECTED" ? <Alert tone="danger" title={t("rejected")}>{request.customerMessage}</Alert> : null}
      {request.status === "DECLINED" ? <Alert tone="warning">{t("declined")}</Alert> : null}
      {request.status === "ACCEPTED" ? (
        <Alert tone="success" title={t("accepted")}>
          {orderLink ? <ButtonLink href={orderLink} size="sm" className="mt-2">{t("viewOrder")}</ButtonLink> : null}
        </Alert>
      ) : null}

      {request.quotedPrice ? (
        <Card as="section" aria-labelledby="quote-title" className="space-y-3 p-5">
          <h2 id="quote-title" className="font-display text-xl font-semibold">{t("quoteTitle")}</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-sm text-muted">{t("quotePrice")}</dt><dd className="ltr-nums text-2xl font-bold">{formatIQD(request.quotedPrice, locale)}</dd></div>
            {request.productionDays ? <div><dt className="text-sm text-muted">{t("quoteDays")}</dt><dd className="text-lg font-semibold">{tc("days", { count: request.productionDays })}</dd></div> : null}
          </dl>
          {request.customerMessage ? <div><p className="text-sm text-muted">{t("quoteMessage")}</p><p className="whitespace-pre-line">{request.customerMessage}</p></div> : null}
        </Card>
      ) : null}

      {request.status === "QUOTED" && request.quotedPrice ? (
        <Card className="p-5">
          <QuoteResponse
            access={{ requestNumber: request.requestNumber, token: tokenStr }}
            price={request.quotedPrice}
            zones={zones.map((z) => ({ id: z.id, nameEn: z.nameEn, nameAr: z.nameAr, areas: z.areas.map((a) => ({ id: a.id, nameEn: a.nameEn, nameAr: a.nameAr })) }))}
          />
        </Card>
      ) : null}

      <Card as="section" aria-labelledby="details-title" className="space-y-4 p-5">
        <h2 id="details-title" className="font-display text-xl font-semibold">{t("details")}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">{t("material")}</dt><dd className="font-medium">{request.material}</dd></div>
          <div><dt className="text-muted">{t("color")}</dt><dd className="font-medium">{request.color}</dd></div>
          <div><dt className="text-muted">{t("scale")}</dt><dd className="ltr-nums font-medium">{request.scalePercent}%</dd></div>
          <div><dt className="text-muted">{t("quantity")}</dt><dd className="ltr-nums font-medium">{request.quantity}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted">{t("notes")}</dt><dd className="whitespace-pre-line">{request.notes || t("noNotes")}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted">{formatDate(request.createdAt, locale, true)}</dt></div>
        </dl>
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t("submittedFiles")}</h3>
          <ul className="space-y-1 text-sm">
            {request.files.map((f, i) => <li key={i} dir="ltr" className="text-start">{f.filename} <span className="text-muted">({formatBytes(f.sizeBytes, locale)})</span></li>)}
          </ul>
        </div>
      </Card>
    </Container>
  );
}
