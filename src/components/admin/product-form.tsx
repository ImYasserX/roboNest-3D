"use client";

import { FormPendingContext, useActionForm } from "@/components/ui/use-action-form";

import { useTranslations } from "next-intl";
import { saveProductAction } from "@/server/actions/admin/products";
import { AVAILABILITY, PRODUCT_STATUSES, PRODUCT_TYPES } from "@/lib/domain";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

type Values = Record<string, string | number | boolean | null | undefined | unknown[]>;
type CategoryOption = { id: string; label: string; group: string };

export function ProductForm({ id, values, categories }: { id?: string; values: Values; categories: CategoryOption[] }) {
  const t = useTranslations("admin.products");
  const ts = useTranslations("status");
  const tc = useTranslations("admin.common");
  const { state, pending: formPending, formProps } = useActionForm(saveProductAction, null);
  const err = (field: string) => {
    const code = state?.errors?.[field];
    if (!code) return undefined;
    return t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.invalid_input");
  };
  const v = (k: string) => (values[k] === null || values[k] === undefined ? "" : String(values[k]));
  const field = (name: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField id={name} name={name} label={t(`fields.${name}`)} defaultValue={v(name)} error={err(name)} {...extra} />
  );
  const groups = [...new Set(categories.map((c) => c.group))];

  return (
    <FormPendingContext.Provider value={formPending}><form {...formProps} className="space-y-6" noValidate>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {state?.ok ? <Alert tone="success">{tc("saved")}</Alert> : null}
      {state?.error ? <Alert tone="danger">{state.error === "forbidden" || state.error === "unauthorized" ? tc(state.error) : t("errors.invalid_input")}</Alert> : null}

      <fieldset className="grid gap-4 rounded-xl border border-border bg-surface p-5 md:grid-cols-2">
        <legend className="px-1 font-display text-lg font-semibold">{t("sections.basics")}</legend>
        {field("nameEn", { required: true, maxLength: 120 })}
        {field("nameAr", { required: true, maxLength: 120, dir: "rtl" })}
        {field("slug", { required: true, maxLength: 80, dir: "ltr", hint: t("fields.slugHint") })}
        <SelectField id="categoryId" name="categoryId" label={t("fields.categoryId")} required defaultValue={v("categoryId")} error={err("categoryId")}>
          <option value="">—</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {categories.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </optgroup>
          ))}
        </SelectField>
        <SelectField id="productType" name="productType" label={t("fields.productType")} required defaultValue={v("productType") || "PHYSICAL"} error={err("productType")}>
          {PRODUCT_TYPES.map((p) => <option key={p} value={p}>{ts(`productType.${p}`)}</option>)}
        </SelectField>
        <SelectField id="status" name="status" label={t("fields.status")} defaultValue={v("status") || "DRAFT"} error={err("status")}>
          {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </SelectField>
        <CheckboxField id="isFeatured" name="isFeatured" label={t("fields.isFeatured")} defaultChecked={values.isFeatured === true} className="md:col-span-2" />
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-border bg-surface p-5 md:grid-cols-2">
        <legend className="px-1 font-display text-lg font-semibold">{t("sections.content")}</legend>
        <TextAreaField id="summaryEn" name="summaryEn" label={t("fields.summaryEn")} defaultValue={v("summaryEn")} maxLength={300} rows={2} className="min-h-16" error={err("summaryEn")} />
        <TextAreaField id="summaryAr" name="summaryAr" label={t("fields.summaryAr")} defaultValue={v("summaryAr")} maxLength={300} rows={2} className="min-h-16" dir="rtl" error={err("summaryAr")} />
        <TextAreaField id="descriptionEn" name="descriptionEn" label={t("fields.descriptionEn")} hint={t("fields.descriptionHint")} defaultValue={v("descriptionEn")} maxLength={8000} rows={6} error={err("descriptionEn")} />
        <TextAreaField id="descriptionAr" name="descriptionAr" label={t("fields.descriptionAr")} hint={t("fields.descriptionHint")} defaultValue={v("descriptionAr")} maxLength={8000} rows={6} dir="rtl" error={err("descriptionAr")} />
        <TextAreaField id="features" name="features" label={t("fields.features")} hint={t("fields.linesHint")} defaultValue={v("features")} rows={3} error={err("features")} />
        <TextAreaField id="included" name="included" label={t("fields.included")} hint={t("fields.linesHint")} defaultValue={v("included")} rows={3} error={err("included")} />
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-border bg-surface p-5 md:grid-cols-3">
        <legend className="px-1 font-display text-lg font-semibold">{t("sections.pricing")}</legend>
        {field("basePrice", { required: true, type: "number", inputMode: "numeric", min: 0, step: 250, dir: "ltr" })}
        {field("salePrice", { type: "number", inputMode: "numeric", min: 0, step: 250, dir: "ltr", hint: t("fields.salePriceHint") })}
        {field("costPrice", { type: "number", inputMode: "numeric", min: 0, step: 250, dir: "ltr", hint: t("fields.costPriceHint") })}
        <SelectField id="availability" name="availability" label={t("fields.availability")} defaultValue={v("availability") || "MADE_TO_ORDER"} error={err("availability")}>
          {AVAILABILITY.map((a) => <option key={a} value={a}>{ts(`availability.${a}`)}</option>)}
        </SelectField>
        {field("stockQuantity", { type: "number", inputMode: "numeric", min: 0, dir: "ltr", hint: t("fields.stockHint") })}
        <div className="grid grid-cols-2 gap-2">
          {field("productionDaysMin", { type: "number", min: 0, max: 180, dir: "ltr" })}
          {field("productionDaysMax", { type: "number", min: 0, max: 180, dir: "ltr" })}
        </div>
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-border bg-surface p-5 md:grid-cols-4">
        <legend className="px-1 font-display text-lg font-semibold">{t("sections.specs")}</legend>
        {field("lengthMm", { type: "number", min: 1, dir: "ltr" })}
        {field("widthMm", { type: "number", min: 1, dir: "ltr" })}
        {field("heightMm", { type: "number", min: 1, dir: "ltr" })}
        {field("weightGrams", { type: "number", min: 1, dir: "ltr" })}
        <div className="grid gap-4 md:col-span-4 md:grid-cols-3">
          {field("materials", { hint: t("fields.csvHint"), maxLength: 600 })}
          {field("colors", { hint: t("fields.csvHint"), maxLength: 1200 })}
          {field("tags", { hint: t("fields.csvHint"), maxLength: 1200 })}
        </div>
        <TextAreaField id="specifications" name="specifications" label={t("fields.specifications")} hint={t("fields.specsHint")} defaultValue={v("specifications")} rows={4} wrapperClassName="md:col-span-4" error={err("specifications")} />
        {field("relatedSlugs", { hint: t("fields.relatedHint"), dir: "ltr", wrapperClassName: "md:col-span-4" })}
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-border bg-surface p-5 md:grid-cols-2">
        <legend className="px-1 font-display text-lg font-semibold">{t("sections.seo")}</legend>
        {field("seoTitleEn", { maxLength: 70 })}
        {field("seoTitleAr", { maxLength: 70, dir: "rtl" })}
        <TextAreaField id="seoDescriptionEn" name="seoDescriptionEn" label={t("fields.seoDescriptionEn")} defaultValue={v("seoDescriptionEn")} maxLength={170} rows={2} className="min-h-16" />
        <TextAreaField id="seoDescriptionAr" name="seoDescriptionAr" label={t("fields.seoDescriptionAr")} defaultValue={v("seoDescriptionAr")} maxLength={170} rows={2} className="min-h-16" dir="rtl" />
      </fieldset>

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <SubmitButton size="lg">{t("saveProduct")}</SubmitButton>
      </div>
    </form></FormPendingContext.Provider>
  );
}
