import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { reviewCustomRequestAction } from "@/server/actions/admin/manage";
import { getCustomRequestAdmin } from "@/server/services/custom-print";
import { CUSTOM_REQUEST_STATUSES } from "@/lib/domain";
import { canAdminTransitionCustomRequest } from "@/lib/order-status";
import { formatBytes, formatDate } from "@/lib/localize";
import { formatIraqiPhone, whatsappLink } from "@/lib/phone";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/custom-requests/[id]">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.customRequests" }))("title") };
}

export default async function CustomRequestAdminPage({ params }: PageProps<"/[locale]/admin/custom-requests/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "customRequests.manage");
  const data = await getCustomRequestAdmin(await getDb(), id);
  if (!data) notFound();
  const { request: r, files } = data;
  const [t, tc, ts, lang] = await Promise.all([getTranslations("admin.customRequests"), getTranslations("admin.common"), getTranslations("status"), getLocale()]);
  const statuses = CUSTOM_REQUEST_STATUSES.filter((s) => s === r.status || canAdminTransitionCustomRequest(r.status, s));
  return (
    <div className="max-w-4xl space-y-6">
      <AdminPageHeader title={t("detailTitle", { number: r.requestNumber })} description={formatDate(r.createdAt, lang, true)}>
        <Badge tone="primary">{ts(`customRequest.${r.status}`)}</Badge>
      </AdminPageHeader>
      <Panel title={tc("name")} id="customer">
        <p className="font-semibold">{r.customerName}</p>
        <a href={whatsappLink(r.customerPhone)} target="_blank" rel="noopener noreferrer" className="ltr-nums text-sm underline">{formatIraqiPhone(r.customerPhone)}</a>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">{t("material")}</dt><dd>{r.material}</dd></div>
          <div><dt className="text-muted">{t("color")}</dt><dd>{r.color}</dd></div>
          <div><dt className="text-muted">{t("scale")}</dt><dd className="ltr-nums">{r.scalePercent}%</dd></div>
          <div><dt className="text-muted">{t("quantity")}</dt><dd className="ltr-nums">{r.quantity}</dd></div>
        </dl>
        {r.notes ? <p className="mt-3 whitespace-pre-line rounded bg-surface-2 p-3 text-sm">{t("notes")}: {r.notes}</p> : null}
        {r.orderId ? <p className="mt-3 text-sm"><Link href={`/admin/orders/${r.orderId}`} className="text-primary-text underline">{t("order")}</Link></p> : null}
      </Panel>
      <Panel title={t("files")} id="files">
        <ul className="space-y-1 text-sm">
          {files.map((f) => <li key={f.id}><a href={`/api/admin/files/${f.id}`} className="underline" dir="ltr">{f.filename}</a> <span className="text-muted">({formatBytes(f.sizeBytes, lang)})</span></li>)}
        </ul>
      </Panel>
      <Panel title={t("review")} id="review">
        <ActionForm action={reviewCustomRequestAction} errorNamespace="admin.customRequests" className="grid gap-3 md:grid-cols-3">
          <input type="hidden" name="id" value={r.id} />
          <SelectField id="status" name="status" label={tc("status")} defaultValue={r.status}>
            {statuses.map((s) => <option key={s} value={s}>{ts(`customRequest.${s}`)}</option>)}
          </SelectField>
          <TextField id="quotedPrice" name="quotedPrice" type="number" min={1} step={250} label={t("quotedPrice")} defaultValue={r.quotedPrice ? String(r.quotedPrice) : ""} dir="ltr" />
          <TextField id="productionDays" name="productionDays" type="number" min={1} max={120} label={t("productionDays")} defaultValue={r.productionDays ? String(r.productionDays) : ""} dir="ltr" />
          <TextAreaField id="customerMessage" name="customerMessage" label={t("customerMessage")} defaultValue={r.customerMessage ?? ""} maxLength={1000} wrapperClassName="md:col-span-3" />
          <TextAreaField id="adminNotes" name="adminNotes" label={t("adminNotes")} defaultValue={r.adminNotes ?? ""} maxLength={2000} wrapperClassName="md:col-span-3" />
          <div><SubmitButton>{t("save")}</SubmitButton></div>
        </ActionForm>
      </Panel>
    </div>
  );
}
