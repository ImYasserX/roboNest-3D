import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { saveDiscountAction } from "@/server/actions/admin/manage";
import { listDiscounts } from "@/server/services/discounts";
import { DISCOUNT_TYPES } from "@/lib/domain";
import { formatIQD } from "@/lib/money";
import { formatDate } from "@/lib/localize";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/discounts">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.discounts" }))("title") };
}

type Row = Awaited<ReturnType<typeof listDiscounts>>[number];
const dateInput = (d: Date | null) => (d ? new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16) : "");

export default async function DiscountsPage({ params }: PageProps<"/[locale]/admin/discounts">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "discounts.manage");
  const [t, tc, lang] = await Promise.all([getTranslations("admin.discounts"), getTranslations("admin.common"), getLocale()]);
  const rows = await listDiscounts(await getDb());
  const form = (d?: Row) => {
    const k = d?.id ?? "new";
    return (
      <ActionForm action={saveDiscountAction} errorNamespace="admin.discounts" className="grid gap-3 md:grid-cols-4">
        {d ? <input type="hidden" name="id" value={d.id} /> : null}
        <TextField id={`code-${k}`} name="code" label={t("code")} defaultValue={d?.code} required dir="ltr" maxLength={40} />
        <SelectField id={`type-${k}`} name="type" label={t("type")} defaultValue={d?.type ?? "PERCENT"}>
          {DISCOUNT_TYPES.map((ty) => <option key={ty} value={ty}>{t(ty)}</option>)}
        </SelectField>
        <TextField id={`val-${k}`} name="value" type="number" min={1} label={t("value")} hint={t("valueHint")} defaultValue={d ? String(d.value) : ""} required dir="ltr" />
        <TextField id={`min-${k}`} name="minSubtotal" type="number" min={0} label={t("minSubtotal")} defaultValue={d ? String(d.minSubtotal) : "0"} dir="ltr" />
        <TextField id={`max-${k}`} name="maxDiscount" type="number" min={1} label={t("maxDiscount")} hint={t("maxDiscountHint")} defaultValue={d?.maxDiscount ? String(d.maxDiscount) : ""} dir="ltr" />
        <TextField id={`uses-${k}`} name="maxUses" type="number" min={1} label={t("maxUses")} defaultValue={d?.maxUses ? String(d.maxUses) : ""} dir="ltr" />
        {/* datetime-local values are Iraq time (UTC+3). */}
        <TextField id={`s-${k}`} name="startsAt" type="datetime-local" label={t("startsAt")} defaultValue={dateInput(d?.startsAt ?? null)} dir="ltr" />
        <TextField id={`e-${k}`} name="endsAt" type="datetime-local" label={t("endsAt")} defaultValue={dateInput(d?.endsAt ?? null)} dir="ltr" />
        <TextField id={`desc-${k}`} name="description" label={t("description")} defaultValue={d?.description} maxLength={200} wrapperClassName="md:col-span-3" />
        <CheckboxField id={`act-${k}`} name="isActive" label={tc("active")} defaultChecked={d ? d.isActive : true} className="self-end pb-2" />
        <div className="md:col-span-4"><SubmitButton>{d ? tc("save") : t("add")}</SubmitButton></div>
      </ActionForm>
    );
  };
  return (
    <div className="max-w-5xl space-y-4">
      <AdminPageHeader title={t("title")} />
      <Panel title={t("add")} id="new">{form()}</Panel>
      <ul className="space-y-2">
        {rows.map((d) => (
          <li key={d.id} className="rounded-xl border border-border bg-surface p-3">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="ltr-nums font-semibold">{d.code}</span>
                <Badge tone="primary">{d.type === "PERCENT" ? `${d.value}%` : formatIQD(d.value, lang)}</Badge>
                <Badge tone={d.isActive ? "success" : "neutral"}>{d.isActive ? tc("active") : tc("inactive")}</Badge>
                <span className="text-sm text-muted">{t("used")}: <span className="ltr-nums">{d.usedCount}{d.maxUses ? ` / ${d.maxUses}` : ""}</span></span>
                {d.endsAt ? <span className="text-sm text-muted">{t("endsAt")}: {formatDate(d.endsAt, lang, true)}</span> : null}
              </summary>
              <div className="mt-3">{form(d)}</div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
