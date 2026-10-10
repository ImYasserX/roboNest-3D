import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getOrderAdmin } from "@/server/services/admin-orders";
import { decideDepositAction, updateOrderNotesAction, updateOrderStatusAction, updatePaymentStatusAction } from "@/server/actions/admin/orders";
import { PAYMENT_STATUSES } from "@/lib/domain";
import { allowedOrderTransitions } from "@/lib/order-status";
import { hasPermission } from "@/lib/permissions";
import { formatIQD } from "@/lib/money";
import { formatBytes, formatDate, pick, pickText } from "@/lib/localize";
import { formatIraqiPhone, whatsappLink } from "@/lib/phone";
import { orderStatusTone } from "@/lib/status-tone";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { buttonClass } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";
import { WhatsappIcon } from "@/components/ui/icons";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/orders/[id]">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.orders" }))("title") };
}

export default async function AdminOrderPage({ params }: PageProps<"/[locale]/admin/orders/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "orders.view");
  const data = await getOrderAdmin(await getDb(), id);
  if (!data) notFound();
  const { order, items, history, files } = data;
  const [t, tc, ts, tco, lang] = await Promise.all([getTranslations("admin.orders"), getTranslations("admin.common"), getTranslations("status"), getTranslations("checkout"), getLocale()]);
  const canEdit = hasPermission(admin.role, "orders.update");
  const canSeeCost = hasPermission(admin.role, "analytics.profit");
  const transitions = allowedOrderTransitions(order.status, { hasPhysical: order.hasPhysical }).filter(
    (to) => !order.depositRequired || order.depositStatus === "VERIFIED" || to === "CANCELLED",
  );
  const iqd = (n: number) => formatIQD(n, lang);

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t("detailTitle", { number: order.orderNumber })} description={formatDate(order.createdAt, lang, true)}>
        <Badge tone={orderStatusTone(order.status)}>{ts(`order.${order.status}`)}</Badge>
        <Badge tone={order.paymentStatus === "PAID" ? "success" : "neutral"}>{ts(`payment.${order.paymentStatus}`)}</Badge>
        <Badge>{order.userId ? t("account") : t("guest")}</Badge>
        {order.customRequestId ? <Badge tone="info">{t("customRequest")}</Badge> : null}
      </AdminPageHeader>

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Panel title={t("items")} id="items">
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold">
                      {item.productId ? <Link href={`/admin/products/${item.productId}`} className="underline">{pick(lang, item.productNameEn, item.productNameAr)}</Link> : pick(lang, item.productNameEn, item.productNameAr)}
                      {item.isDigital ? <Badge tone="info" className="ms-2">{t("digital")}</Badge> : null}
                    </p>
                    {item.options.length ? (
                      <ul className="text-muted">
                        {item.options.map((o) => (
                          <li key={o.optionId} className="break-words">{pickText(lang, o.label)}: <span className="text-text">{pickText(lang, o.value)}</span>{o.priceDelta ? <span className="ltr-nums"> (+{iqd(o.priceDelta)})</span> : null}</li>
                        ))}
                      </ul>
                    ) : null}
                    {canSeeCost && item.unitCost !== null ? <p className="text-xs text-muted">{t("unitCost")}: <span className="ltr-nums">{iqd(item.unitCost)}</span></p> : null}
                  </div>
                  <p className="text-end"><bdi className="ltr-nums">{iqd(item.unitPrice)}</bdi> × <bdi className="ltr-nums">{item.quantity}</bdi><br /><strong className="ltr-nums">{iqd(item.lineTotal)}</strong></p>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
              <div className="flex justify-between"><dt>{tco("discount")} {order.discountCode ? `(${order.discountCode})` : ""}</dt><dd className="ltr-nums">− {iqd(order.discountTotal)}</dd></div>
              <div className="flex justify-between"><dt>{tco("deliveryFee")}</dt><dd className="ltr-nums">{iqd(order.deliveryFee)}</dd></div>
              <div className="flex justify-between text-base font-bold"><dt>{tc("total")}</dt><dd className="ltr-nums">{iqd(order.total)}</dd></div>
            </dl>
          </Panel>

          {files.length ? (
            <Panel title={t("files")} id="files">
              <ul className="space-y-2 text-sm">
                {files.map((f) => (
                  <li key={f.id}>
                    <a href={`/api/admin/files/${f.id}`} className="underline" dir="ltr">{f.filename}</a> <span className="text-muted">({formatBytes(f.sizeBytes, lang)})</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title={t("history")} id="history">
            <ol className="space-y-3 text-sm">
              {history.map((h) => (
                <li key={h.id} className="border-s-2 border-primary ps-3">
                  <p className="font-medium">{h.fromStatus ? `${ts(`order.${h.fromStatus}`)} → ` : ""}{ts(`order.${h.toStatus}`)}</p>
                  <p className="text-muted">{formatDate(h.createdAt, lang, true)} · {t("by", { actor: h.actorLabel })}</p>
                  {h.publicNote ? <p className="mt-1">{h.publicNote}</p> : null}
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title={t("customerSection")} id="customer">
            <div className="space-y-1 text-sm">
              <p className="font-semibold">{order.customerName}</p>
              <p className="ltr-nums">{formatIraqiPhone(order.customerPhone)}</p>
              {order.hasPhysical ? (
                <>
                  <p>{[pick(lang, order.governorateEn, order.governorateAr), order.city, order.district].filter(Boolean).join(" · ")}</p>
                  <p>{order.addressLine}</p>
                  {order.landmark ? <p className="text-muted">{order.landmark}</p> : null}
                  {order.deliveryNotes ? <p className="text-muted">{t("deliveryNotes")}: {order.deliveryNotes}</p> : null}
                </>
              ) : null}
              {order.orderNotes ? <p className="mt-2 rounded bg-surface-2 p-2">{t("notes")}: {order.orderNotes}</p> : null}
              {order.userId && hasPermission(admin.role, "customers.view") ? <Link href={`/admin/customers/${order.userId}`} className="text-primary-text underline">{t("account")}</Link> : null}
              <a href={whatsappLink(order.customerPhone)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm", "mt-2")}>
                <WhatsappIcon size={16} /> {t("whatsapp")}
              </a>
            </div>
          </Panel>

          {order.depositRequired ? (
            <Panel title={t("deposit.title")} id="deposit">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted">{t("deposit.amount")}</dt><dd className="ltr-nums font-semibold">{iqd(order.depositAmount)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted">{t("deposit.status")}</dt><dd><Badge tone={order.depositStatus === "VERIFIED" ? "success" : order.depositStatus === "SUBMITTED" ? "info" : "warning"}>{ts(`deposit.${order.depositStatus}`)}</Badge></dd></div>
                {order.depositMethod ? <div className="flex justify-between gap-2"><dt className="text-muted">{t("deposit.method")}</dt><dd>{ts(`depositMethod.${order.depositMethod}`)}</dd></div> : null}
                {order.depositReference ? <div className="flex justify-between gap-2"><dt className="text-muted">{t("deposit.reference")}</dt><dd dir="ltr" className="break-all font-mono">{order.depositReference}</dd></div> : null}
                {order.depositVerifiedAt ? <div className="flex justify-between gap-2"><dt className="text-muted">{t("deposit.verifiedAt")}</dt><dd>{formatDate(order.depositVerifiedAt, lang, true)}</dd></div> : null}
                <div className="flex justify-between gap-2"><dt className="text-muted">{t("deposit.balance")}</dt><dd className="ltr-nums">{iqd(order.total - order.depositAmount)}</dd></div>
              </dl>
              {order.status === "DEPOSIT_SUBMITTED" && hasPermission(admin.role, "deposits.verify") ? (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  <p className="text-sm text-muted">{t("deposit.checkHint")}</p>
                  <ActionForm action={decideDepositAction} errorNamespace="admin.orders">
                    <input type="hidden" name="orderId" value={order.id} />
                    <TextField id="receivedAmount" name="receivedAmount" inputMode="numeric" dir="ltr" label={t("deposit.receivedAmount")} hint={t("deposit.receivedAmountHint", { amount: iqd(order.depositAmount) })} maxLength={12} />
                    <TextAreaField id="depositNote" name="publicNote" label={t("publicNote")} hint={t("publicNoteHint")} maxLength={500} rows={2} className="min-h-16" />
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton name="decision" value="verify">{t("deposit.verify")}</SubmitButton>
                      <SubmitButton name="decision" value="reject" variant="secondary">{t("deposit.reject")}</SubmitButton>
                    </div>
                  </ActionForm>
                </div>
              ) : order.status === "DEPOSIT_SUBMITTED" ? (
                <p className="mt-3 text-sm text-muted">{t("deposit.noPermission")}</p>
              ) : null}
            </Panel>
          ) : null}

          {canEdit ? (
            <>
              <Panel title={t("statusSection")} id="status">
                {transitions.length === 0 ? (
                  <p className="text-sm text-muted">{t("noTransitions")}</p>
                ) : (
                  <ActionForm action={updateOrderStatusAction} errorNamespace="admin.orders">
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="expectedFrom" value={order.status} />
                    <SelectField id="to" name="to" label={t("newStatus")} required defaultValue={transitions[0]}>
                      {transitions.map((s) => <option key={s} value={s}>{ts(`order.${s}`)}</option>)}
                    </SelectField>
                    <TextAreaField id="publicNote" name="publicNote" label={t("publicNote")} hint={t("publicNoteHint")} maxLength={500} rows={2} className="min-h-16" />
                    <SubmitButton className="w-full">{t("updateStatus")}</SubmitButton>
                  </ActionForm>
                )}
              </Panel>
              <Panel title={t("paymentSection")} id="payment">
                <ActionForm action={updatePaymentStatusAction} errorNamespace="admin.orders">
                  <input type="hidden" name="orderId" value={order.id} />
                  <SelectField id="paymentStatus" name="paymentStatus" label={t("paymentStatus")} defaultValue={order.paymentStatus} hint={t("paymentHint")}>
                    {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{ts(`payment.${s}`)}</option>)}
                  </SelectField>
                  <SubmitButton variant="secondary" className="w-full">{t("updatePayment")}</SubmitButton>
                </ActionForm>
              </Panel>
              <Panel title={t("adminNotes")} id="notes">
                <ActionForm action={updateOrderNotesAction}>
                  <input type="hidden" name="orderId" value={order.id} />
                  <TextAreaField id="adminNotes" name="adminNotes" label={t("adminNotes")} hint={t("adminNotesHint")} defaultValue={order.adminNotes ?? ""} maxLength={2000} />
                  <SubmitButton variant="secondary">{t("saveNotes")}</SubmitButton>
                </ActionForm>
              </Panel>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
