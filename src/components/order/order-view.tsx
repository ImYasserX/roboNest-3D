import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import type { CustomerOrderView } from "@/server/services/orders";
import { DEPOSIT_STAGE_STATUSES, ORDER_PROGRESS } from "@/lib/order-status";
import type { OrderStatus } from "@/lib/domain";
import { paymentDue, paymentWhatsappText } from "@/lib/payment-due";
import { formatIQD } from "@/lib/money";
import { formatDate, mediaUrl, pick, pickText } from "@/lib/localize";
import { formatIraqiPhone } from "@/lib/phone";
import { BUSINESS, businessWhatsappUrl } from "@/lib/business";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { CheckIcon, CubeIcon, WhatsappIcon } from "@/components/ui/icons";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";

const OFF_TRACK = ["CANCELLED", "FAILED_DELIVERY", "RETURN_REQUESTED", "RETURNED"];

/** Optional transfer details configured in admin → Payments (shown with the WhatsApp step). */
export type PaymentMethodInfo = { code: string; instructions: string };

export async function OrderView({ order, justPlaced, paymentMethods }: { order: CustomerOrderView; justPlaced?: boolean; paymentMethods: PaymentMethodInfo[] }) {
  const [t, ts, tco, tcart, tn, locale] = await Promise.all([getTranslations("order"), getTranslations("status"), getTranslations("checkout"), getTranslations("cart"), getTranslations("nav"), getLocale()]);
  const baseSteps: readonly OrderStatus[] = order.hasPhysical ? ORDER_PROGRESS : ["PENDING", "CONFIRMED", "DELIVERED"];
  // Deposit orders replace the PENDING step with the three deposit steps.
  const steps: readonly OrderStatus[] = order.depositRequired ? [...DEPOSIT_STAGE_STATUSES, ...baseSteps.filter((s) => s !== "PENDING")] : baseSteps;
  const currentIndex = steps.indexOf(order.status);
  const balance = order.total - (order.depositStatus === "VERIFIED" ? order.depositAmount : 0);
  const offTrack = OFF_TRACK.includes(order.status);

  return (
    <div className="space-y-8">
      {justPlaced ? (
        <Alert tone="success" title={t("confirmedTitle")}>
          <p>{t("confirmedText", { number: order.orderNumber, phone: formatIraqiPhone(order.customerPhone) })}</p>
          <p className="mt-1 text-muted">{t("saveLink")}</p>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-bold">
            {t("title", { number: "" })}
            <span className="ltr-nums">{order.orderNumber}</span>
          </h1>
          <p className="text-muted">{t("placedOn", { date: formatDate(order.createdAt, locale, true) })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={order.status === "DELIVERED" ? "success" : offTrack ? "danger" : "primary"}>
            {t("currentStatus")}: {ts(`order.${order.status}`)}
          </Badge>
          <Badge tone={order.paymentStatus === "PAID" ? "success" : "neutral"}>{ts(`payment.${order.paymentStatus}`)}</Badge>
        </div>
      </div>

      <PaymentStep order={order} methods={paymentMethods} />

      <section aria-labelledby="progress-title" className="space-y-4">
        <h2 id="progress-title" className="font-display text-xl font-semibold">
          {t("progress")}
        </h2>
        <p className="text-muted">{ts(`orderDescription.${order.status}`)}</p>
        {offTrack ? null : (
          <ol className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {steps.map((step, i) => {
              const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
              return (
                <li
                  key={step}
                  aria-current={state === "current" ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-3 text-sm",
                    state === "done" && "border-success/40 bg-success-soft",
                    state === "current" && "border-primary bg-primary-soft font-semibold",
                    state === "upcoming" && "border-border text-muted",
                  )}
                >
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs", state === "done" ? "border-success text-success" : state === "current" ? "border-primary-text text-primary-text" : "border-border-strong")} aria-hidden="true">
                    {state === "done" ? <CheckIcon size={14} /> : i + 1}
                  </span>
                  <span>
                    {ts(`order.${step}`)}
                    <span className="sr-only">, {t(state === "done" ? "stepDone" : state === "current" ? "stepCurrent" : "stepUpcoming")}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {order.hasDigital ? (
        <Alert tone={order.paymentStatus === "PAID" ? "success" : "info"}>
          <span>{order.paymentStatus === "PAID" ? t("digitalReady") : t("digitalPending")} </span>
          {order.paymentStatus === "PAID" ? (
            <Link href="/account/downloads" className="font-semibold underline">
              {t("goToDownloads")}
            </Link>
          ) : null}
        </Alert>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="items-title" className="space-y-3">
          <h2 id="items-title" className="font-display text-xl font-semibold">
            {t("items")}
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {order.items.map((item) => (
              <li key={item.id} className="flex gap-4 p-4">
                <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                  {item.imageKey ? <Image src={mediaUrl(item.imageKey)} alt="" fill sizes="64px" className="object-cover" /> : <CubeIcon className="m-auto mt-5 text-muted" />}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-semibold">{pick(locale, item.productNameEn, item.productNameAr)}</p>
                    <p className="ltr-nums font-semibold">{formatIQD(item.lineTotal, locale)}</p>
                  </div>
                  {item.options.length ? (
                    <p className="text-sm text-muted">
                      {item.options.map((o) => `${pickText(locale, o.label)}: ${pickText(locale, o.value)}`).join(" · ")}
                    </p>
                  ) : null}
                  <p className="text-sm text-muted">
                    <bdi className="ltr-nums">{formatIQD(item.unitPrice, locale)}</bdi> × <bdi className="ltr-nums">{item.quantity}</bdi>
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {order.history.some((h) => h.publicNote) ? (
            <div className="space-y-2">
              <h3 className="font-semibold">{t("history")}</h3>
              <ul className="space-y-2 text-sm">
                {order.history
                  .filter((h) => h.publicNote)
                  .map((h, i) => (
                    <li key={i} className="rounded-lg border border-border bg-surface p-3">
                      <span className="font-medium">{ts(`order.${h.toStatus}`)}</span>
                      <span className="text-muted"> · {formatDate(h.createdAt, locale, true)}</span>
                      <p className="mt-1">{h.publicNote}</p>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <Card as="section" className="space-y-2 p-5" aria-labelledby="sum-title">
            <h2 id="sum-title" className="font-display text-lg font-semibold">
              {t("summary")}
            </h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{tcart("subtotal")}</dt>
                <dd className="ltr-nums">{formatIQD(order.subtotal, locale)}</dd>
              </div>
              {order.discountTotal > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted">
                    {tco("discount")} {order.discountCode ? <span className="ltr-nums">({order.discountCode})</span> : null}
                  </dt>
                  <dd className="ltr-nums">− {formatIQD(order.discountTotal, locale)}</dd>
                </div>
              ) : null}
              {order.hasPhysical ? (
                <div className="flex justify-between">
                  <dt className="text-muted">{tco("deliveryFee")}</dt>
                  <dd className="ltr-nums">{formatIQD(order.deliveryFee, locale)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
                <dt>{order.hasPhysical ? tco("total") : tco("totalDigital")}</dt>
                <dd className="ltr-nums">{formatIQD(order.total, locale)}</dd>
              </div>
              {order.depositRequired ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("deposit.depositLine")}</dt>
                    <dd className="ltr-nums">{formatIQD(order.depositAmount, locale)}</dd>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <dt>{t("deposit.balanceLine")}</dt>
                    <dd className="ltr-nums">{formatIQD(order.depositStatus === "VERIFIED" ? balance : order.total - order.depositAmount, locale)}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            <p className="text-sm text-muted">
              {t("payment")}: {ts(`paymentMethod.${order.paymentMethod}`)} · {ts(`payment.${order.paymentStatus}`)}
            </p>
          </Card>
          {order.hasPhysical ? (
            <Card as="section" className="space-y-1 p-5 text-sm" aria-labelledby="addr-title">
              <h2 id="addr-title" className="mb-2 font-display text-lg font-semibold">
                {t("deliveryTo")}
              </h2>
              <p className="font-medium">{order.customerName}</p>
              <p className="ltr-nums">{formatIraqiPhone(order.customerPhone)}</p>
              <p>{[pick(locale, order.governorateEn, order.governorateAr), order.city, order.district].filter(Boolean).join(locale === "ar" ? "، " : ", ")}</p>
              <p>{order.addressLine}</p>
              {order.landmark ? <p className="text-muted">{order.landmark}</p> : null}
              {order.deliveryNotes ? <p className="text-muted">{order.deliveryNotes}</p> : null}
            </Card>
          ) : null}
          {order.orderNotes ? (
            <Card className="p-5 text-sm">
              <h2 className="mb-1 font-semibold">{t("notes")}</h2>
              <p className="whitespace-pre-line">{order.orderNotes}</p>
            </Card>
          ) : null}
          <Card className="space-y-3 p-5 text-sm">
            <p className="font-medium">{t("needHelp")}</p>
            <a
              href={businessWhatsappUrl(t("whatsappMessage", { number: order.orderNumber }))}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={tn("whatsappChat", { number: BUSINESS.whatsapp.display })}
              className={buttonClass("secondary", "md", "w-full")}
            >
              <WhatsappIcon size={18} /> {t("helpWhatsapp")}
            </a>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/**
 * What to pay now and how: the amount comes from the order row (lib/payment-due),
 * and the WhatsApp button only opens a chat. Nothing on this page can mark a
 * payment as received; an Owner verifies it in the admin.
 */
async function PaymentStep({ order, methods }: { order: CustomerOrderView; methods: PaymentMethodInfo[] }) {
  const [t, ts, locale] = await Promise.all([getTranslations("order.payment"), getTranslations("status"), getLocale()]);
  const due = paymentDue(order);
  const depositDone = order.depositRequired && order.depositStatus === "VERIFIED";
  if (!due) {
    if (!order.depositRequired && order.paymentStatus !== "PAID") return null;
    return (
      <section aria-labelledby="payment-title" className="space-y-2 rounded-xl border border-success/40 bg-success-soft p-5">
        <h2 id="payment-title" className="font-display text-xl font-semibold">{t("title")}</h2>
        {depositDone ? <p>{t("depositVerified", { amount: formatIQD(order.depositAmount, locale) })}</p> : null}
        {order.paymentStatus === "PAID" ? <p>{t("paidVerified")}</p> : null}
        {order.paymentStatus === "REFUNDED" ? <p>{t("refunded")}</p> : null}
      </section>
    );
  }
  const href = businessWhatsappUrl(paymentWhatsappText(locale, order.orderNumber, due));
  const purpose = due.kind === "DEPOSIT" ? t("purposeDeposit") : depositDone ? t("purposeBalance") : t("purposeFull");
  return (
    <section aria-labelledby="payment-title" className="space-y-4 rounded-xl border border-warning/40 bg-surface p-5" data-testid="payment-step">
      <div className="space-y-1">
        <h2 id="payment-title" className="font-display text-xl font-semibold">{due.kind === "DEPOSIT" ? t("titleDeposit") : t("title")}</h2>
        {due.kind === "DEPOSIT" ? <p className="text-sm text-muted">{t("whyDeposit")}</p> : null}
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-bg p-3">
          <dt className="text-xs text-muted">{t("reference")}</dt>
          <dd className="ltr-nums font-mono font-semibold" dir="ltr">{order.orderNumber}</dd>
        </div>
        <div className="rounded-lg border border-border bg-bg p-3">
          <dt className="text-xs text-muted">{t("amountDue")}</dt>
          <dd className="ltr-nums text-lg font-semibold" data-testid="amount-due">{formatIQD(due.amount, locale)}</dd>
        </div>
        <div className="rounded-lg border border-border bg-bg p-3">
          <dt className="text-xs text-muted">{t("purpose")}</dt>
          <dd className="font-semibold">{purpose}</dd>
        </div>
      </dl>
      {depositDone ? <Alert tone="success">{t("depositVerified", { amount: formatIQD(order.depositAmount, locale) })}</Alert> : null}
      {order.paymentStatus === "DISPUTED" ? <Alert tone="warning">{t("disputed")}</Alert> : null}
      {order.depositStatus === "SUBMITTED" ? (
        <Alert tone="info">{t("legacySubmitted", { method: order.depositMethod ? ts(`depositMethod.${order.depositMethod}`) : "", reference: order.depositReference ?? "" })}</Alert>
      ) : null}
      {due.channel === "ON_DELIVERY" ? (
        <p className="text-sm">{t("onDelivery", { amount: formatIQD(due.amount, locale) })}</p>
      ) : (
        <p className="text-sm">{t("howTo")}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass(due.channel === "ON_DELIVERY" ? "secondary" : "primary", "lg")} data-testid="whatsapp-payment">
          <WhatsappIcon size={20} />
          {due.channel === "ON_DELIVERY" ? t("whatsappOptional") : t("whatsapp")}
        </a>
        <span className="text-sm text-muted">
          {t("orCall")} <a href={`tel:${BUSINESS.phones[0].tel}`} className="ltr-nums underline" dir="ltr">{BUSINESS.phones[0].display}</a>
        </span>
      </div>
      {methods.length > 0 && due.channel === "WHATSAPP" ? (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">{t("transferDetails")}</summary>
          <ul className="mt-2 space-y-2">
            {methods.map((m) => (
              <li key={m.code}>
                <p className="text-sm font-semibold">{ts(`depositMethod.${m.code}`)}</p>
                <p className="whitespace-pre-line text-sm text-muted">{m.instructions}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-xs text-muted">{t("notReceivedUntilVerified")}</p>
    </section>
  );
}
