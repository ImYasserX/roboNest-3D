import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { deleteAreaAction, saveAreaAction, updateZoneAction } from "@/server/actions/admin/manage";
import { listDeliveryZones } from "@/server/services/delivery";
import { pick } from "@/lib/localize";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader } from "@/components/admin/ui";
import { CheckboxField, TextField } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/misc";
import { formatIQD } from "@/lib/money";
import { FLAT_DELIVERY_FEE_IQD } from "@/lib/payment-rules";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/delivery">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.delivery" }))("title") };
}

export default async function DeliveryAdminPage({ params }: PageProps<"/[locale]/admin/delivery">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "delivery.edit");
  const [t, tc, lang] = await Promise.all([getTranslations("admin.delivery"), getTranslations("admin.common"), getLocale()]);
  const zones = await listDeliveryZones(await getDb());
  return (
    <div className="max-w-5xl space-y-4">
      <AdminPageHeader title={t("title")} description={t("text")} />
      <Alert tone="info">{t("flatFee", { fee: formatIQD(FLAT_DELIVERY_FEE_IQD, lang) })}</Alert>
      <ul className="space-y-3">
        {zones.map((z) => (
          <li key={z.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{pick(lang, z.nameEn, z.nameAr)}</h2>
              <Badge className="ltr-nums">{z.code}</Badge>
              {!z.isActive ? <Badge tone="warning">{tc("inactive")}</Badge> : null}
            </div>
            <ActionForm action={updateZoneAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={z.id} />
              <TextField id={`min-${z.id}`} name="etaDaysMin" type="number" min={0} max={30} label={t("etaMin")} defaultValue={String(z.etaDaysMin)} dir="ltr" wrapperClassName="w-28" />
              <TextField id={`max-${z.id}`} name="etaDaysMax" type="number" min={0} max={30} label={t("etaMax")} defaultValue={String(z.etaDaysMax)} dir="ltr" wrapperClassName="w-28" />
              <CheckboxField id={`act-${z.id}`} name="isActive" label={tc("active")} defaultChecked={z.isActive} className="pb-2" />
              <SubmitButton variant="secondary">{tc("save")}</SubmitButton>
            </ActionForm>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-primary-text">{t("areas")} ({z.areas.length})</summary>
              <div className="mt-2 space-y-2">
                {z.areas.length === 0 ? <p className="text-sm text-muted">{t("noAreas")}</p> : null}
                {z.areas.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-end gap-2 rounded-md bg-surface-2 p-2">
                    <AreaForm zoneId={z.id} area={a} t={t} tc={tc} />
                    <ActionForm action={deleteAreaAction} className="">
                      <input type="hidden" name="zoneId" value={z.id} /><input type="hidden" name="areaId" value={a.id} />
                      <SubmitButton variant="danger" size="sm">{tc("delete")}</SubmitButton>
                    </ActionForm>
                  </div>
                ))}
                <div className="rounded-md border border-dashed border-border p-2">
                  <p className="mb-1 text-sm font-medium">{t("addArea")}</p>
                  <AreaForm zoneId={z.id} t={t} tc={tc} />
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

type TT = Awaited<ReturnType<typeof getTranslations<"admin.delivery">>>;
type TC = Awaited<ReturnType<typeof getTranslations<"admin.common">>>;

function AreaForm({ zoneId, area, t, tc }: { zoneId: string; area?: { id: string; nameEn: string; nameAr: string; fee: number; isActive: boolean }; t: TT; tc: TC }) {
  const k = area?.id ?? `new-${zoneId}`;
  return (
    <ActionForm action={saveAreaAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="zoneId" value={zoneId} />
      {area ? <input type="hidden" name="areaId" value={area.id} /> : null}
      <TextField id={`aen-${k}`} name="nameEn" label={t("areaNameEn")} defaultValue={area?.nameEn} required maxLength={60} wrapperClassName="w-44" />
      <TextField id={`aar-${k}`} name="nameAr" label={t("areaNameAr")} defaultValue={area?.nameAr} required maxLength={60} dir="rtl" wrapperClassName="w-44" />
      <CheckboxField id={`aact-${k}`} name="isActive" label={tc("active")} defaultChecked={area ? area.isActive : true} className="pb-2" />
      <SubmitButton variant="secondary" size="sm" className="min-h-11">{area ? tc("save") : tc("add")}</SubmitButton>
    </ActionForm>
  );
}
