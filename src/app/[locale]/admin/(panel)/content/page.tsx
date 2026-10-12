import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { saveCustomPrintOptionsAction, saveHomepageAction, saveStoreAction } from "@/server/actions/admin/manage";
import { getSettings } from "@/server/services/settings";
import { BUSINESS } from "@/lib/business";
import { pickText } from "@/lib/localize";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/content">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.content" }))("title") };
}

export default async function ContentPage({ params }: PageProps<"/[locale]/admin/content">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "content.edit");
  const [t, tc] = await Promise.all([getTranslations("admin.content"), getTranslations("admin.common")]);
  const s = await getSettings(await getDb(), ["homepage", "store", "customPrint"]);
  const pair = (name: string, label: string, value: { en: string; ar: string }, max: number, area = false) => {
    const F = area ? TextAreaField : TextField;
    return (
      <>
        <F id={`${name}En`} name={`${name}En`} label={`${label} (${tc("englishLabel")})`} defaultValue={value.en} maxLength={max} />
        <F id={`${name}Ar`} name={`${name}Ar`} label={`${label} (${tc("arabicLabel")})`} defaultValue={value.ar} maxLength={max} dir="rtl" />
      </>
    );
  };
  const lines = (items: { code: string; en: string; ar: string }[]) => items.map((i) => `${i.code} | ${i.en} | ${i.ar}`).join("\n");
  return (
    <div className="max-w-4xl space-y-6">
      <AdminPageHeader title={t("title")} />
      <Panel title={t("homepage")} id="home">
        <ActionForm action={saveHomepageAction} errorNamespace="admin.content" className="grid gap-3 md:grid-cols-2">
          {pair("announcement", t("announcement"), s.homepage.announcement, 160)}
          {pair("heroTitle", t("heroTitle"), s.homepage.heroTitle, 90)}
          {pair("heroSubtitle", t("heroSubtitle"), s.homepage.heroSubtitle, 240, true)}
          <div><SubmitButton>{tc("save")}</SubmitButton></div>
        </ActionForm>
      </Panel>
      <Panel title={t("store")} id="store">
        <div className="mb-4 rounded-lg border border-border bg-surface-2 p-3 text-sm">
          <p className="font-semibold">{t("fixedContact")}</p>
          <p className="text-muted">{t("fixedContactHint")}</p>
          <ul className="mt-2 space-y-0.5">
            <li dir="ltr">{BUSINESS.email}</li>
            {BUSINESS.phones.map((p) => <li key={p.tel} className="ltr-nums">{p.display}</li>)}
            <li className="ltr-nums">WhatsApp: {BUSINESS.whatsapp.display}</li>
            <li>{pickText(locale, BUSINESS.hours)}</li>
          </ul>
        </div>
        <ActionForm action={saveStoreAction} errorNamespace="admin.content" className="grid gap-3 md:grid-cols-2">
          <TextField id="instagram" name="instagram" type="url" label={t("instagram")} defaultValue={s.store.instagram} dir="ltr" />
          <TextField id="facebook" name="facebook" type="url" label={t("facebook")} defaultValue={s.store.facebook} dir="ltr" wrapperClassName="md:col-span-2" />
          {pair("address", t("address"), s.store.address, 200)}
          <div><SubmitButton>{tc("save")}</SubmitButton></div>
        </ActionForm>
      </Panel>
      <Panel title={t("customPrint")} id="cp">
        <ActionForm action={saveCustomPrintOptionsAction} errorNamespace="admin.content" className="grid gap-3 md:grid-cols-2">
          <TextAreaField id="materials" name="materials" label={t("materials")} hint={t("choicesHint")} defaultValue={lines(s.customPrint.materials)} rows={6} dir="ltr" />
          <TextAreaField id="colors" name="colors" label={t("colors")} hint={t("choicesHint")} defaultValue={lines(s.customPrint.colors)} rows={6} dir="ltr" />
          <div><SubmitButton>{tc("save")}</SubmitButton></div>
        </ActionForm>
      </Panel>
    </div>
  );
}
