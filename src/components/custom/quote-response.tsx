"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { acceptQuoteAction, declineQuoteAction } from "@/server/actions/custom-print";
import { formatIQD } from "@/lib/money";
import { pick } from "@/lib/localize";
import { SelectField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import type { CheckoutZone } from "@/components/checkout/checkout-form";

export function QuoteResponse({ access, price, zones }: { access: { requestNumber: string; token: string | null }; price: number; zones: CheckoutZone[] }) {
  const t = useTranslations("custom");
  const tco = useTranslations("checkout");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [v, setV] = useState({ zoneId: "", areaId: "", city: "", district: "", addressLine: "", landmark: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const zone = zones.find((z) => z.id === v.zoneId);
  const fee = zone ? (zone.areas.find((a) => a.id === v.areaId)?.fee ?? zone.fee) : null;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value, ...(k === "zoneId" ? { areaId: "" } : {}) }));
  const errText = (code: string) => (code === "rate_limited" ? tc("rateLimited") : t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.failed"));

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await acceptQuoteAction(access, v);
          if (res.ok) router.push(res.url);
          else setError(errText(res.error));
        });
      }}
    >
      <h2 className="font-display text-xl font-semibold">{t("acceptTitle")}</h2>
      <p className="text-sm text-muted">{t("acceptText", { price: formatIQD(price, locale) })}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id="q-zone" label={tco("governorate")} required value={v.zoneId} onChange={set("zoneId")}>
          <option value="">{tco("chooseGovernorate")}</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{pick(locale, z.nameEn, z.nameAr)} — {formatIQD(z.fee, locale)}</option>)}
        </SelectField>
        {zone && zone.areas.length ? (
          <SelectField id="q-area" label={tco("area")} value={v.areaId} onChange={set("areaId")}>
            <option value="">{tco("otherArea")}</option>
            {zone.areas.map((a) => <option key={a.id} value={a.id}>{pick(locale, a.nameEn, a.nameAr)} — {formatIQD(a.fee, locale)}</option>)}
          </SelectField>
        ) : null}
        <TextField id="q-city" label={tco("city")} required value={v.city} onChange={set("city")} maxLength={80} />
        <TextField id="q-district" label={tco("district")} required value={v.district} onChange={set("district")} maxLength={80} />
        <TextField id="q-address" label={tco("addressLine")} required wrapperClassName="sm:col-span-2" value={v.addressLine} onChange={set("addressLine")} maxLength={200} />
        <TextField id="q-landmark" label={tco("landmark")} optionalLabel={tc("optional")} wrapperClassName="sm:col-span-2" value={v.landmark} onChange={set("landmark")} maxLength={120} />
      </div>
      <p className="text-sm">
        {tco("total")}: <strong className="ltr-nums">{formatIQD(price + (fee ?? 0), locale)}</strong>
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={pending}>{pending ? t("accepting") : t("accept")}</Button>
        <Button
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await declineQuoteAction(access);
              if (res.ok) router.refresh();
              else setError(errText(res.error));
            })
          }
        >
          {t("decline")}
        </Button>
      </div>
    </form>
  );
}
