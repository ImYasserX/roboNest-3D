"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { placeOrderAction } from "@/server/actions/checkout";
import { previewDiscountAction } from "@/server/actions/cart";
import { formatIQD } from "@/lib/money";
import { pick } from "@/lib/localize";
import { CheckboxField, SelectField, TextAreaField, TextField, controlClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { CashIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { DEPOSIT_THRESHOLD_IQD, FLAT_DELIVERY_FEE_IQD, depositAmountFor, depositBase, requiresDeposit } from "@/lib/payment-rules";

export type CheckoutZone = {
  id: string;
  nameEn: string;
  nameAr: string;
  areas: { id: string; nameEn: string; nameAr: string }[];
};

type Props = {
  idempotencyKey: string;
  zones: CheckoutZone[];
  subtotal: number;
  hasPhysical: boolean;
  hasDigital: boolean;
  signedIn: boolean;
  /** Whether a deposit can currently be paid (online provider or owner-approved manual fallback). */
  initial: { fullName: string; phone: string; zoneId: string; areaId: string; city: string; district: string; addressLine: string; landmark: string };
};

const FIELD_ERROR_KEYS = ["invalid_phone", "zone_unavailable", "area_unavailable"];

export function CheckoutForm({ idempotencyKey, zones, subtotal, hasPhysical, hasDigital, signedIn, initial }: Props) {
  const t = useTranslations("checkout");
  const tc = useTranslations("common");
  const tcart = useTranslations("cart");
  const locale = useLocale();
  const router = useRouter();
  const [values, setValues] = useState({ ...initial, deliveryNotes: "", orderNotes: "", discountCode: "", saveAddress: signedIn });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [discount, setDiscount] = useState<{ code: string; amount: number } | null>(null);
  const [discountMsg, setDiscountMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [checkingCode, startCodeTransition] = useTransition();

  const zone = zones.find((z) => z.id === values.zoneId);
  // Preview only; the server recalculates the fee and any deposit itself.
  const fee = hasPhysical ? (zone ? FLAT_DELIVERY_FEE_IQD : null) : 0;
  const discountAmount = discount && discount.code === values.discountCode.trim().toUpperCase() ? discount.amount : 0;
  const total = subtotal - Math.min(discountAmount, subtotal) + (fee ?? 0);
  const needsDeposit = requiresDeposit(depositBase(subtotal, discountAmount));
  // Preview of the server rule: 30% of the products subtotal after discount (rounded down).
  const deposit = needsDeposit ? depositAmountFor(depositBase(subtotal, discountAmount)) : null;

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
    setValues((v) => ({ ...v, [key]: value, ...(key === "zoneId" ? { areaId: "" } : {}) }));
    setFieldErrors((f) => ({ ...f, [key]: "" }));
  };
  const errorText = (key: string) => {
    const code = fieldErrors[key];
    if (!code) return undefined;
    if (code.startsWith("discount_") || FIELD_ERROR_KEYS.includes(code)) return t(`errors.${code}`);
    return t("errors.invalid_input");
  };

  function applyCode() {
    const code = values.discountCode.trim();
    if (!code) return;
    startCodeTransition(async () => {
      const res = await previewDiscountAction(code);
      if (res.ok) {
        setDiscount({ code: code.toUpperCase(), amount: res.amount });
        setDiscountMsg(t("codeApplied", { amount: formatIQD(res.amount, locale) }));
        setFieldErrors((f) => ({ ...f, discountCode: "" }));
      } else {
        setDiscount(null);
        setDiscountMsg(null);
        setFieldErrors((f) => ({ ...f, discountCode: res.error === "rate_limited" ? "" : res.error }));
        if (res.error === "rate_limited") setFormError(tc("rateLimited"));
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const res = await placeOrderAction({ idempotencyKey, ...values, discountCode: values.discountCode.trim() || undefined });
      if (res.ok) {
        router.replace(res.url);
        return;
      }
      setFieldErrors(res.fields ?? {});
      setFormError(res.error === "rate_limited" ? tc("rateLimited") : t(`errors.${res.error}` as "errors.failed"));
      // Move focus to the summary so screen-reader users hear the problem.
      requestAnimationFrame(() => document.getElementById("checkout-error")?.focus());
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-8 lg:grid-cols-[1fr_24rem]">
      <div className="space-y-8">
        {formError ? (
          <div id="checkout-error" tabIndex={-1} className="outline-none">
            <Alert tone="danger">{formError}</Alert>
          </div>
        ) : null}

        <fieldset className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <legend className="px-1 font-display text-lg font-semibold">{t("contact")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="fullName" label={t("fullName")} required autoComplete="name" value={values.fullName} onChange={set("fullName")} error={errorText("fullName")} maxLength={80} />
            <TextField id="phone" label={t("phone")} required type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={values.phone} onChange={set("phone")} hint={t("phoneHint")} error={errorText("phone")} maxLength={24} />
          </div>
        </fieldset>

        {hasPhysical ? (
          <fieldset className="space-y-4 rounded-xl border border-border bg-surface p-5">
            <legend className="px-1 font-display text-lg font-semibold">{t("delivery")}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField id="zoneId" label={t("governorate")} required value={values.zoneId} onChange={set("zoneId")} error={errorText("zoneId")} autoComplete="address-level1">
                <option value="">{t("chooseGovernorate")}</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {pick(locale, z.nameEn, z.nameAr)}
                  </option>
                ))}
              </SelectField>
              {zone && zone.areas.length > 0 ? (
                <SelectField id="areaId" label={t("area")} value={values.areaId} onChange={set("areaId")} error={errorText("areaId")}>
                  <option value="">{t("otherArea")}</option>
                  {zone.areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {pick(locale, a.nameEn, a.nameAr)}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              <TextField id="city" label={t("city")} required autoComplete="address-level2" value={values.city} onChange={set("city")} error={errorText("city")} maxLength={80} />
              <TextField id="district" label={t("district")} required autoComplete="address-level3" value={values.district} onChange={set("district")} error={errorText("district")} maxLength={80} />
              <TextField id="addressLine" label={t("addressLine")} required autoComplete="street-address" wrapperClassName="sm:col-span-2" value={values.addressLine} onChange={set("addressLine")} hint={t("addressHint")} error={errorText("addressLine")} maxLength={200} />
              <TextField id="landmark" label={t("landmark")} optionalLabel={tc("optional")} wrapperClassName="sm:col-span-2" value={values.landmark} onChange={set("landmark")} hint={t("landmarkHint")} maxLength={120} />
              <TextAreaField id="deliveryNotes" label={t("deliveryNotes")} optionalLabel={tc("optional")} wrapperClassName="sm:col-span-2" rows={2} value={values.deliveryNotes} onChange={set("deliveryNotes")} maxLength={300} className="min-h-20" />
            </div>
            {signedIn ? <CheckboxField id="saveAddress" label={t("saveAddress")} checked={values.saveAddress} onChange={set("saveAddress")} /> : null}
            <p className="text-sm text-muted">{t("deliveryArrangement", { fee: formatIQD(FLAT_DELIVERY_FEE_IQD, locale) })}</p>
          </fieldset>
        ) : (
          <Alert tone="info">{t("noDelivery")}</Alert>
        )}

        <fieldset className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <legend className="px-1 font-display text-lg font-semibold">{t("payment")}</legend>
          <label className="flex items-start gap-3 rounded-lg border-2 border-primary bg-primary-soft p-4">
            <input type="radio" name="paymentMethod" value="COD" checked readOnly className="mt-1 size-5 accent-primary" />
            <span>
              <span className="flex items-center gap-2 font-semibold">
                <CashIcon size={18} /> {t("codTitle")}
              </span>
              <span className="block text-sm text-muted">{t("codText")}</span>
              {hasDigital ? <span className="mt-1 block text-sm text-muted">{t("codDigital")}</span> : null}
              <span className="mt-1 block text-sm text-muted">{t("whatsappStep")}</span>
            </span>
          </label>
          {needsDeposit ? (
            <Alert tone="warning" title={t("depositTitle")}>
              {t("depositText", { threshold: formatIQD(DEPOSIT_THRESHOLD_IQD, locale), amount: formatIQD(deposit ?? 0, locale) })}
            </Alert>
          ) : null}
          <TextAreaField id="orderNotes" label={t("orderNotes")} optionalLabel={tc("optional")} rows={2} value={values.orderNotes} onChange={set("orderNotes")} maxLength={500} className="min-h-20" />
        </fieldset>
      </div>

      <aside aria-labelledby="checkout-summary" className="h-fit space-y-4 rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-24">
        <h2 id="checkout-summary" className="font-display text-lg font-semibold">
          {tcart("summary")}
        </h2>
        <div className="space-y-1.5">
          <label htmlFor="discountCode" className="block text-sm font-medium">
            {t("discountCode")}
          </label>
          <div className="flex gap-2">
            <input
              id="discountCode"
              value={values.discountCode}
              onChange={set("discountCode")}
              maxLength={40}
              autoCapitalize="characters"
              dir="ltr"
              aria-describedby="discount-status"
              aria-invalid={fieldErrors.discountCode ? true : undefined}
              className={controlClass}
            />
            <Button variant="secondary" onClick={applyCode} disabled={checkingCode || !values.discountCode.trim()}>
              {t("applyCode")}
            </Button>
          </div>
          <p id="discount-status" aria-live="polite" className="text-sm">
            {errorText("discountCode") ? <span className="text-danger">⚠ {errorText("discountCode")}</span> : discountMsg ? <span className="text-success">✓ {discountMsg}</span> : null}
          </p>
        </div>
        <dl className="space-y-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{tcart("subtotal")}</dt>
            <dd className="ltr-nums">{formatIQD(subtotal, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t("discount")}</dt>
            <dd className="ltr-nums">{discountAmount ? `− ${formatIQD(discountAmount, locale)}` : formatIQD(0, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t("deliveryFee")}</dt>
            <dd className="ltr-nums">{!hasPhysical ? tc("free") : fee === null ? t("deliveryChooseGovernorate") : formatIQD(fee, locale)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
            <dt>{hasPhysical ? t("total") : t("totalDigital")}</dt>
            <dd className="ltr-nums" aria-live="polite">
              {formatIQD(total, locale)}
            </dd>
          </div>
          {deposit !== null ? (
            <>
              <div className="flex justify-between">
                <dt className="text-muted">{t("depositLine")}</dt>
                <dd className="ltr-nums">{formatIQD(deposit, locale)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>{t("balanceLine")}</dt>
                <dd className="ltr-nums">{formatIQD(total - deposit, locale)}</dd>
              </div>
            </>
          ) : null}
        </dl>
        <button
          type="submit"
          disabled={pending}
          aria-disabled={pending}
          className="flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-6 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? t("placing") : t("placeOrder")}
        </button>
        <p className="text-xs text-muted">{t("reviewNote")}</p>
        <p className="text-xs text-muted">
          {t.rich("policyNote", {
            terms: (c) => <Link href="/terms" className="underline">{c}</Link>,
            delivery: (c) => <Link href="/delivery" className="underline">{c}</Link>,
            payment: (c) => <Link href="/payment" className="underline">{c}</Link>,
            returns: (c) => <Link href="/returns" className="underline">{c}</Link>,
          })}
        </p>
      </aside>
    </form>
  );
}
