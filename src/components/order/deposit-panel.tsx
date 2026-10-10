"use client";

import { useLocale, useTranslations } from "next-intl";
import { checkOnlineDepositAction, startOnlineDepositAction, submitDepositAction } from "@/server/actions/deposit";
import { FormPendingContext, useActionForm } from "@/components/ui/use-action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatIQD } from "@/lib/money";

export type DepositMethodInfo = { code: string; instructions: string };

/** Shown on the order page while the deposit is awaited. Reporting a transfer never marks it paid. */
export function DepositForm({ orderNumber, token, amount, methods }: { orderNumber: string; token: string | null; amount: number; methods: DepositMethodInfo[] }) {
  const t = useTranslations("order.deposit");
  const ts = useTranslations("status");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { state, pending, formProps } = useActionForm(submitDepositAction, null);
  if (state?.ok) return <Alert tone="success">{t("submitted")}</Alert>;
  const error = state?.error === "rate_limited" ? tc("rateLimited") : state?.error ? (t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : tc("unknownError")) : null;
  return (
    <div className="space-y-4">
      <p>{t("instructionsIntro", { amount: formatIQD(amount, locale) })}</p>
      <ul className="space-y-3">
        {methods.map((m) => (
          <li key={m.code} className="rounded-lg border border-border bg-bg p-3">
            <p className="font-semibold">{ts(`depositMethod.${m.code}`)}</p>
            <p className="whitespace-pre-line text-sm text-muted">{m.instructions}</p>
          </li>
        ))}
      </ul>
      <FormPendingContext.Provider value={pending}>
        <form {...formProps} className="grid gap-3 sm:grid-cols-2" noValidate>
          {error ? <Alert tone="danger" className="sm:col-span-2">{error}</Alert> : null}
          <input type="hidden" name="orderNumber" value={orderNumber} />
          {token ? <input type="hidden" name="token" value={token} /> : null}
          <SelectField id="deposit-method" name="method" label={t("method")} required defaultValue={methods[0]?.code}>
            {methods.map((m) => (
              <option key={m.code} value={m.code}>{ts(`depositMethod.${m.code}`)}</option>
            ))}
          </SelectField>
          <TextField id="deposit-reference" name="reference" label={t("reference")} hint={t("referenceHint")} required minLength={4} maxLength={64} dir="ltr" autoComplete="off" />
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel={t("sending")}>{t("submit")}</SubmitButton>
          </div>
        </form>
      </FormPendingContext.Provider>
      <p className="text-xs text-muted">{t("manualNote")}</p>
    </div>
  );
}

/** `open`: created and still valid, computed on the server at render time. */
export type OnlinePaymentInfo = { status: string; open: boolean; payInfo: Record<string, string | null> } | null;

/** Pay the deposit with the FIB app. Paid status only ever comes from FIB's status check on our server. */
export function OnlineDepositPanel({ orderNumber, token, amount, payment }: { orderNumber: string; token: string | null; amount: number; payment: OnlinePaymentInfo }) {
  const t = useTranslations("order.deposit");
  const tc = useTranslations("common");
  const locale = useLocale();
  const start = useActionForm(startOnlineDepositAction, null);
  const check = useActionForm(checkOnlineDepositAction, null);
  const open = Boolean(payment?.open);
  const errorText = (code?: string) => (code ? (code === "rate_limited" ? tc("rateLimited") : t.has(`online.errors.${code}`) ? t(`online.errors.${code}`) : tc("unknownError")) : null);
  const hidden = (
    <>
      <input type="hidden" name="orderNumber" value={orderNumber} />
      {token ? <input type="hidden" name="token" value={token} /> : null}
    </>
  );
  return (
    <div className="space-y-3 rounded-lg border border-primary/40 bg-primary-soft p-4">
      <p className="font-semibold">{t("online.title", { amount: formatIQD(amount, locale) })}</p>
      {open && payment ? (
        <div className="space-y-3">
          {payment.payInfo.qrCode ? (
            // eslint-disable-next-line @next/next/no-img-element -- provider-generated data: URI, not a remote image
            <img src={payment.payInfo.qrCode.startsWith("data:") ? payment.payInfo.qrCode : `data:image/png;base64,${payment.payInfo.qrCode}`} alt={t("online.qrAlt")} width={180} height={180} className="rounded-md bg-white p-2" />
          ) : null}
          {payment.payInfo.readableCode ? (
            <p className="text-sm">
              {t("online.readableCode")}: <bdi className="ltr-nums font-mono font-semibold">{payment.payInfo.readableCode}</bdi>
            </p>
          ) : null}
          {payment.payInfo.personalAppLink ? (
            <a href={payment.payInfo.personalAppLink} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover" rel="noopener noreferrer">
              {t("online.openApp")}
            </a>
          ) : null}
          <FormPendingContext.Provider value={check.pending}>
            <form {...check.formProps} className="space-y-2">
              {hidden}
              {check.state?.error ? <Alert tone={check.state.error === "unpaid" ? "info" : "danger"}>{errorText(check.state.error)}</Alert> : null}
              <SubmitButton variant="secondary" pendingLabel={t("online.checking")}>{t("online.check")}</SubmitButton>
            </form>
          </FormPendingContext.Provider>
        </div>
      ) : (
        <FormPendingContext.Provider value={start.pending}>
          <form {...start.formProps} className="space-y-2">
            {hidden}
            {start.state?.error ? <Alert tone="danger">{errorText(start.state.error)}</Alert> : null}
            {payment && payment.status === "DECLINED" ? <Alert tone="warning">{t("online.declined")}</Alert> : null}
            <SubmitButton pendingLabel={t("online.starting")}>{t("online.start")}</SubmitButton>
          </form>
        </FormPendingContext.Provider>
      )}
      <p className="text-xs text-muted">{t("online.note")}</p>
    </div>
  );
}
