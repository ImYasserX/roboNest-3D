import { getLocale, getTranslations } from "next-intl/server";
import { confirmPaymentAction, disputePaymentAction, recordRefundAction } from "@/server/actions/admin/orders";
import { PAYMENT_CHANNELS, type DepositStatus, type OrderStatus, type PaymentStatus } from "@/lib/domain";
import { paymentDue } from "@/lib/payment-due";
import { formatIQD } from "@/lib/money";
import { formatDate } from "@/lib/localize";
import { ConfirmDialog } from "./confirm-dialog";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/misc";

export type PanelOrder = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: number;
  currency: string;
  depositRequired: boolean;
  depositAmount: number;
  depositStatus: DepositStatus;
  hasDigital: boolean;
  hasPhysical: boolean;
};

type Verification = { id: string; kind: string; action: string; amount: number; channel: string | null; note: string | null; adminLabel: string; createdAt: Date };

/** The decision buttons for one order. Rendered only for admins with payments.verify. */
export async function PaymentDecisionButtons({ order, compact = false }: { order: PanelOrder; compact?: boolean }) {
  const [t, lang] = await Promise.all([getTranslations("admin.paymentsQueue"), getLocale()]);
  const due = paymentDue(order);
  const iqd = (n: number) => formatIQD(n, lang);
  const purpose = due?.kind === "DEPOSIT" ? t("purpose.DEPOSIT") : order.depositRequired && order.depositStatus === "VERIFIED" ? t("purpose.BALANCE") : t("purpose.FULL");
  const summary = due ? (
    <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-bg p-3 text-sm">
      <div><dt className="text-xs text-muted">{t("reference")}</dt><dd className="ltr-nums font-mono font-semibold" dir="ltr">{order.orderNumber}</dd></div>
      <div><dt className="text-xs text-muted">{t("amount")}</dt><dd className="ltr-nums font-semibold">{iqd(due.amount)}</dd></div>
      <div><dt className="text-xs text-muted">{t("purposeLabel")}</dt><dd className="font-semibold">{purpose}</dd></div>
    </dl>
  ) : null;
  const hidden = (kind: string) => (
    <>
      <input type="hidden" name="orderId" value={order.id} />
      <input type="hidden" name="kind" value={kind} />
    </>
  );
  const refundable = order.paymentStatus === "PAID" || (order.status === "CANCELLED" && order.depositStatus === "VERIFIED");
  return (
    <div className={compact ? "flex flex-wrap gap-2" : "flex flex-wrap gap-2 border-t border-border pt-4"}>
      {due ? (
        <>
          <ConfirmDialog
            trigger={t("confirm")}
            triggerVariant="primary"
            testId={`confirm-payment-${order.orderNumber}`}
            title={t("confirmTitle")}
            description={t("confirmWarning")}
            confirmLabel={t("confirmButton", { amount: iqd(due.amount) })}
            action={confirmPaymentAction}
            errorNamespace="admin.paymentsQueue"
            successText={t("confirmed")}
          >
            {summary}
            {hidden(due.kind)}
            <TextField id={`amount-${order.id}`} name="receivedAmount" inputMode="numeric" dir="ltr" required autoComplete="off" label={t("receivedAmount")} hint={t("receivedAmountHint", { amount: iqd(due.amount) })} maxLength={12} />
            <SelectField id={`channel-${order.id}`} name="channel" label={t("channel")} defaultValue={due.channel === "ON_DELIVERY" ? "CASH_ON_DELIVERY" : "WHATSAPP_TRANSFER"}>
              {PAYMENT_CHANNELS.map((c) => <option key={c} value={c}>{t(`channels.${c}`)}</option>)}
            </SelectField>
            <TextAreaField id={`note-${order.id}`} name="note" label={t("evidence")} hint={t("evidenceHint")} maxLength={500} rows={2} className="min-h-16" />
            <CheckboxField id={`checked-${order.id}`} name="checked" required label={t("checkedLabel")} />
          </ConfirmDialog>
          {order.paymentStatus !== "DISPUTED" || due.kind === "DEPOSIT" ? (
            <ConfirmDialog
              trigger={due.kind === "DEPOSIT" ? t("reject") : t("dispute")}
              triggerVariant="ghost"
              title={due.kind === "DEPOSIT" ? t("rejectTitle") : t("disputeTitle")}
              description={t("disputeText")}
              confirmLabel={due.kind === "DEPOSIT" ? t("reject") : t("dispute")}
              tone="danger"
              action={disputePaymentAction}
              errorNamespace="admin.paymentsQueue"
            >
              {summary}
              {hidden(due.kind)}
              <TextAreaField id={`reason-${order.id}`} name="reason" required minLength={3} label={t("reason")} hint={t("reasonHint")} maxLength={500} rows={2} className="min-h-16" />
              <TextAreaField id={`public-${order.id}`} name="publicNote" label={t("publicNote")} hint={t("publicNoteHint")} maxLength={500} rows={2} className="min-h-16" />
            </ConfirmDialog>
          ) : null}
        </>
      ) : null}
      {refundable && !compact ? (
        <ConfirmDialog
          trigger={t("refund")}
          triggerVariant="ghost"
          title={t("refundTitle")}
          description={t("refundText")}
          confirmLabel={t("refund")}
          tone="danger"
          action={recordRefundAction}
          errorNamespace="admin.paymentsQueue"
        >
          {hidden(order.paymentStatus === "PAID" ? "FULL" : "DEPOSIT")}
          <TextAreaField id={`refund-reason-${order.id}`} name="reason" required minLength={3} label={t("refundReason")} maxLength={500} rows={2} className="min-h-16" />
          <TextField id={`refund-confirm-${order.id}`} name="confirmText" required autoComplete="off" dir="ltr" label={t("refundConfirm")} hint={t("refundConfirmHint")} maxLength={10} />
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** Payment summary and verification history for the admin order page. */
export async function PaymentPanel({ order, verifications, canVerify }: { order: PanelOrder; verifications: Verification[]; canVerify: boolean }) {
  const [t, ts, lang] = await Promise.all([getTranslations("admin.paymentsQueue"), getTranslations("status"), getLocale()]);
  const due = paymentDue(order);
  const iqd = (n: number) => formatIQD(n, lang);
  return (
    <div className="space-y-4" data-testid="payment-panel">
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-2"><dt className="text-muted">{t("paymentStatus")}</dt><dd><Badge tone={order.paymentStatus === "PAID" ? "success" : order.paymentStatus === "DISPUTED" ? "danger" : "warning"}>{ts(`payment.${order.paymentStatus}`)}</Badge></dd></div>
        {order.depositRequired ? (
          <>
            <div className="flex justify-between gap-2"><dt className="text-muted">{t("depositRequired")}</dt><dd className="ltr-nums font-semibold">{iqd(order.depositAmount)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">{t("depositStatus")}</dt><dd><Badge tone={order.depositStatus === "VERIFIED" ? "success" : "warning"}>{ts(`deposit.${order.depositStatus}`)}</Badge></dd></div>
          </>
        ) : null}
        <div className="flex justify-between gap-2"><dt className="text-muted">{t("total")}</dt><dd className="ltr-nums">{iqd(order.total)} {order.currency}</dd></div>
        <div className="flex justify-between gap-2 font-semibold"><dt>{t("dueNow")}</dt><dd className="ltr-nums">{due ? `${iqd(due.amount)} · ${due.kind === "DEPOSIT" ? t("purpose.DEPOSIT") : t("purpose.FULL")}` : t("nothingDue")}</dd></div>
      </dl>
      {due?.channel === "ON_DELIVERY" ? <p className="text-xs text-muted">{t("codHint")}</p> : null}
      {order.hasDigital ? <Alert tone={order.paymentStatus === "PAID" ? "success" : "info"}>{order.paymentStatus === "PAID" ? t("downloadsOpen") : t("downloadsLocked")}</Alert> : null}
      {canVerify ? <PaymentDecisionButtons order={order} /> : due ? <p className="text-sm text-muted">{t("ownerOnly")}</p> : null}
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("history")}</h3>
        {verifications.length === 0 ? (
          <p className="text-sm text-muted">{t("noHistory")}</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {verifications.map((v) => (
              <li key={v.id} className="rounded-md border border-border p-2">
                <p className="font-medium">
                  <Badge tone={v.action === "CONFIRMED" ? "success" : v.action === "REFUND_RECORDED" ? "info" : "danger"}>{t(`actions.${v.action}`)}</Badge>{" "}
                  {t(`purpose.${v.kind}`)} · <span className="ltr-nums">{iqd(v.amount)}</span>
                  {v.channel ? <span className="text-muted"> · {t(`channels.${v.channel}`)}</span> : null}
                </p>
                <p className="text-xs text-muted">{formatDate(v.createdAt, lang, true)} · {v.adminLabel}</p>
                {v.note ? <p className="mt-1 break-words">{v.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
