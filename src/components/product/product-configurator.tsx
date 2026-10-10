"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addToCartAction } from "@/server/actions/cart";
import type { Availability, OptionType, ProductStatus, ProductType } from "@/lib/domain";
import { formatIQD } from "@/lib/money";
import { pick } from "@/lib/localize";
import { resolveLine, type LineError, type PricingProduct, type Selections } from "@/lib/pricing";
import { ButtonLink } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { MinusIcon, PlusIcon, UploadIcon } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";

export type ConfiguratorOption = {
  id: string;
  type: OptionType;
  labelEn: string;
  labelAr: string;
  helpEn: string;
  helpAr: string;
  isRequired: boolean;
  priceDelta: number;
  pricePerUnit: number;
  minValue: number | null;
  maxValue: number | null;
  unitEn: string;
  unitAr: string;
  values: { id: string; labelEn: string; labelAr: string; priceDelta: number; swatch: string | null }[];
};

type Props = {
  product: {
    id: string;
    productType: ProductType;
    status: ProductStatus;
    availability: Availability;
    stockQuantity: number | null;
    basePrice: number;
    salePrice: number | null;
  };
  options: ConfiguratorOption[];
  productName: string;
};

function initialSelections(options: ConfiguratorOption[]): Selections {
  const s: Selections = {};
  for (const o of options) {
    if ((o.type === "SELECT" || o.type === "RADIO") && o.isRequired && o.values[0]) s[o.id] = o.values[0].id;
    if (o.type === "NUMBER" && o.isRequired && o.minValue !== null) s[o.id] = o.minValue;
  }
  return s;
}

export function ProductConfigurator({ product, options }: Props) {
  const t = useTranslations("product");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [selections, setSelections] = useState<Selections>(() => initialSelections(options));
  const [quantity, setQuantity] = useState(1);
  const [uploads, setUploads] = useState<Record<string, { name: string; state: "uploading" | "done" | "error"; error?: string }>>({});
  const [serverErrors, setServerErrors] = useState<LineError[] | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [touched, setTouched] = useState(false);

  // Preview only: the server recomputes the price when the item is added.
  const pricing: PricingProduct = useMemo(
    () => ({
      ...product,
      options: options.map((o) => ({ ...o, values: o.values.map((v) => ({ ...v, isActive: true })) })),
    }),
    [product, options],
  );
  const preview = resolveLine(pricing, selections, quantity);
  const clientErrors = preview.ok ? [] : preview.errors;
  const errors = serverErrors ?? (touched ? clientErrors : []);
  const errorFor = (optionId: string) => errors.find((e) => e.optionId === optionId);
  const optionLabel = (o: ConfiguratorOption) => pick(locale, o.labelEn, o.labelAr);
  const errorText = (e: LineError) => {
    const option = options.find((o) => o.id === e.optionId);
    return t(`errors.${e.code}`, { option: option ? optionLabel(option) : "" });
  };

  function set(optionId: string, value: Selections[string] | undefined) {
    setServerErrors(null);
    setMessage(null);
    setSelections((prev) => {
      const next = { ...prev };
      if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete next[optionId];
      else next[optionId] = value;
      return next;
    });
  }

  async function uploadFile(optionId: string, file: File) {
    setUploads((u) => ({ ...u, [optionId]: { name: file.name, state: "uploading" } }));
    set(optionId, undefined);
    try {
      const res = await fetch(`/api/uploads?purpose=PRODUCT_OPTION&filename=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
      const body = (await res.json()) as { id?: string; filename?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? "failed");
      setUploads((u) => ({ ...u, [optionId]: { name: body.filename ?? file.name, state: "done" } }));
      set(optionId, body.id);
    } catch (error) {
      const code = error instanceof Error ? error.message : "failed";
      setUploads((u) => ({ ...u, [optionId]: { name: file.name, state: "error", error: code } }));
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setMessage(null);
    if (!preview.ok) return;
    startTransition(async () => {
      const result = await addToCartAction({ productId: product.id, quantity, options: selections });
      if (result.ok) {
        setServerErrors(null);
        setMessage({ tone: "success", text: t("added") });
      } else if (result.lineErrors) {
        setServerErrors(result.lineErrors);
      } else {
        setMessage({ tone: "danger", text: result.error === "rate_limited" ? tc("rateLimited") : t(`errors.${result.error in ERROR_KEYS ? result.error : "invalid_value"}`, { option: "" }) });
      }
    });
  }

  const deltaLabel = (amount: number) => (amount > 0 ? ` (${t("optionAdds", { amount: formatIQD(amount, locale) })})` : "");
  const unitPrice = preview.ok ? preview.line.unitPrice : null;
  const generalErrors = errors.filter((e) => !e.optionId);

  return (
    <form onSubmit={submit} noValidate className="space-y-6" aria-describedby="price-note">
      {options.length > 0 ? (
        <fieldset className="space-y-5">
          <legend className="mb-1 font-display text-lg font-semibold">{t("customize")}</legend>
          {options.map((o) => {
            const id = `opt-${o.id}`;
            const help = pick(locale, o.helpEn, o.helpAr);
            const err = errorFor(o.id);
            const describedBy = [help ? `${id}-help` : null, err ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
            const label = (
              <>
                {optionLabel(o)}
                {o.isRequired ? <span className="text-danger" aria-hidden="true"> *</span> : null}
                {o.isRequired ? <span className="sr-only"> ({t("optionRequired")})</span> : null}
              </>
            );
            const footer = (
              <>
                {help ? (
                  <p id={`${id}-help`} className="text-sm text-muted">
                    {help}
                  </p>
                ) : null}
                {err ? (
                  <p id={`${id}-err`} className="text-sm font-medium text-danger">
                    ⚠ {errorText(err)}
                  </p>
                ) : null}
              </>
            );

            if (o.type === "RADIO" || (o.type === "CHECKBOX" && o.values.length > 0)) {
              const isCheckbox = o.type === "CHECKBOX";
              const selected = selections[o.id];
              return (
                <fieldset key={o.id} className="space-y-2" aria-describedby={describedBy} aria-invalid={err ? true : undefined}>
                  <legend className="text-sm font-medium">{label}</legend>
                  <div className="flex flex-wrap gap-2">
                    {o.values.map((v) => {
                      const checked = isCheckbox ? Array.isArray(selected) && selected.includes(v.id) : selected === v.id;
                      return (
                        <label
                          key={v.id}
                          className={cn(
                            "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
                            checked ? "border-primary bg-primary-soft" : "border-border-strong hover:bg-surface-2",
                          )}
                        >
                          <input
                            type={isCheckbox ? "checkbox" : "radio"}
                            name={id}
                            value={v.id}
                            checked={checked}
                            className="size-4 accent-primary"
                            onChange={(e) => {
                              if (!isCheckbox) return set(o.id, v.id);
                              const current = Array.isArray(selected) ? selected : [];
                              set(o.id, e.target.checked ? [...current, v.id] : current.filter((x) => x !== v.id));
                            }}
                          />
                          <span>
                            {pick(locale, v.labelEn, v.labelAr)}
                            <span className="text-muted">{deltaLabel(v.priceDelta)}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {footer}
                </fieldset>
              );
            }

            return (
              <div key={o.id} className="space-y-1.5">
                {o.type === "CHECKBOX" ? (
                  <div className="flex items-start gap-3">
                    <input id={id} type="checkbox" className="mt-1 size-5 accent-primary" checked={selections[o.id] === true} aria-describedby={describedBy} onChange={(e) => set(o.id, e.target.checked ? true : undefined)} />
                    <label htmlFor={id} className="text-sm font-medium">
                      {label}
                      <span className="font-normal text-muted">{deltaLabel(o.priceDelta)}</span>
                    </label>
                  </div>
                ) : (
                  <label htmlFor={id} className="block text-sm font-medium">
                    {label}
                    {o.type !== "SELECT" ? <span className="font-normal text-muted">{deltaLabel(o.priceDelta)}</span> : null}
                  </label>
                )}
                {o.type === "SELECT" ? (
                  <div className="flex items-center gap-3">
                    <select id={id} className={controlClass} value={(selections[o.id] as string) ?? ""} aria-describedby={describedBy} aria-invalid={err ? true : undefined} onChange={(e) => set(o.id, e.target.value)}>
                      {!o.isRequired ? <option value="">{t("chooseOption")}</option> : null}
                      {o.values.map((v) => (
                        <option key={v.id} value={v.id}>
                          {pick(locale, v.labelEn, v.labelAr)}
                          {deltaLabel(v.priceDelta)}
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const swatch = o.values.find((v) => v.id === selections[o.id])?.swatch;
                      return swatch ? <span aria-hidden="true" className="size-9 shrink-0 rounded-full border border-border-strong" style={{ background: swatch }} /> : null;
                    })()}
                  </div>
                ) : null}
                {o.type === "NUMBER" ? (
                  <>
                    <input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={o.minValue ?? undefined}
                      max={o.maxValue ?? undefined}
                      className={controlClass}
                      value={(selections[o.id] as number | undefined) ?? ""}
                      aria-describedby={[describedBy, `${id}-range`].filter(Boolean).join(" ")}
                      aria-invalid={err ? true : undefined}
                      onChange={(e) => set(o.id, e.target.value === "" ? undefined : Number(e.target.value))}
                    />
                    <p id={`${id}-range`} className="text-sm text-muted">
                      {t("range", { min: o.minValue ?? 0, max: o.maxValue ?? "∞", unit: pick(locale, o.unitEn, o.unitAr) })}
                      {o.pricePerUnit > 0 ? ` · ${t("optionPerUnit", { amount: formatIQD(o.pricePerUnit, locale), unit: pick(locale, o.unitEn, o.unitAr) || "1", min: o.minValue ?? 0 })}` : ""}
                    </p>
                  </>
                ) : null}
                {o.type === "TEXT" ? (
                  <input id={id} type="text" maxLength={o.maxValue ?? 120} className={controlClass} value={(selections[o.id] as string) ?? ""} aria-describedby={describedBy} aria-invalid={err ? true : undefined} onChange={(e) => set(o.id, e.target.value)} />
                ) : null}
                {o.type === "TEXTAREA" ? (
                  <textarea id={id} maxLength={o.maxValue ?? 1000} rows={3} className={controlClass} value={(selections[o.id] as string) ?? ""} aria-describedby={describedBy} aria-invalid={err ? true : undefined} onChange={(e) => set(o.id, e.target.value)} />
                ) : null}
                {o.type === "FILE" ? (
                  <div className="space-y-2">
                    <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-4 text-sm font-medium hover:bg-surface-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus">
                      <UploadIcon size={18} />
                      <span>{uploads[o.id]?.state === "uploading" ? t("uploading") : t("uploadFile")}</span>
                      <input id={id} type="file" className="sr-only" accept=".stl,.3mf,.obj,.zip,.png,.jpg,.jpeg,.webp" aria-describedby={describedBy} onChange={(e) => e.target.files?.[0] && uploadFile(o.id, e.target.files[0])} />
                    </label>
                    <p aria-live="polite" className="text-sm">
                      {uploads[o.id]?.state === "done" ? <span className="text-success">✓ {t("uploaded", { name: uploads[o.id].name })}</span> : null}
                      {uploads[o.id]?.state === "error" ? <span className="text-danger">⚠ {t("errors.invalid_upload")}</span> : null}
                    </p>
                  </div>
                ) : null}
                {footer}
              </div>
            );
          })}
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <label htmlFor="qty" className="block text-sm font-medium">
            {t("quantity")}
          </label>
          <div className="flex items-center rounded-md border border-border-strong">
            <button type="button" className="inline-flex size-11 items-center justify-center hover:bg-surface-2 disabled:opacity-40" aria-label={t("decrease")} disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
              <MinusIcon size={18} />
            </button>
            <input
              id="qty"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))))}
              className="ltr-nums h-11 w-14 border-x border-border-strong bg-transparent text-center"
            />
            <button type="button" className="inline-flex size-11 items-center justify-center hover:bg-surface-2 disabled:opacity-40" aria-label={t("increase")} disabled={quantity >= 100} onClick={() => setQuantity((q) => Math.min(100, q + 1))}>
              <PlusIcon size={18} />
            </button>
          </div>
        </div>
        <div className="min-w-0 flex-1 text-end" aria-live="polite">
          {unitPrice !== null ? (
            <>
              <p className="text-sm text-muted">
                {t("unitPrice")}: <span className="ltr-nums">{formatIQD(unitPrice, locale)}</span>
              </p>
              <p className="text-xl font-bold">
                {t("total")}: <span className="ltr-nums">{formatIQD(unitPrice * quantity, locale)}</span>
              </p>
            </>
          ) : null}
        </div>
      </div>

      {generalErrors.map((e) => (
        <Alert key={e.code} tone="danger">
          {errorText(e)}
        </Alert>
      ))}
      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        className="flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-6 text-base font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60"
      >
        {pending ? t("adding") : t("addToCart")}
      </button>
      <p id="price-note" className="text-xs text-muted">
        {t("priceCalculated")}
      </p>
      {message ? (
        <Alert tone={message.tone}>
          <span>{message.text} </span>
          {message.tone === "success" ? (
            <ButtonLink href="/cart" variant="secondary" size="sm" className="ms-2 mt-1">
              {t("viewCart")}
            </ButtonLink>
          ) : null}
        </Alert>
      ) : null}
    </form>
  );
}

const ERROR_KEYS = {
  invalid_upload: 1,
  too_many_lines: 1,
  not_found: 1,
  invalid_value: 1,
} as const;
