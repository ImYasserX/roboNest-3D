import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { createResetLinkAction, deleteCustomerAction, updateCustomerAction } from "@/server/actions/admin/manage";
import { getCustomer } from "@/server/services/customers";
import { hasPermission } from "@/lib/permissions";
import { formatIQD } from "@/lib/money";
import { formatDate } from "@/lib/localize";
import { formatIraqiPhone, whatsappLink } from "@/lib/phone";
import { orderStatusTone } from "@/lib/status-tone";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/ui/field";
import { Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/customers/[id]">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.customers" }))("title") };
}

export default async function CustomerPage({ params }: PageProps<"/[locale]/admin/customers/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "customers.view");
  const data = await getCustomer(await getDb(), id);
  if (!data) notFound();
  const { user, orders, addresses } = data;
  const [t, tc, ts, lang] = await Promise.all([getTranslations("admin.customers"), getTranslations("admin.common"), getTranslations("status"), getLocale()]);
  const canEdit = hasPermission(admin.role, "customers.edit");
  return (
    <div className="max-w-4xl space-y-6">
      <AdminPageHeader title={t("detailTitle", { name: user.name })} description={`${t("joined")}: ${formatDate(user.createdAt, lang)} · ${t("lastLogin")}: ${user.lastLoginAt ? formatDate(user.lastLoginAt, lang, true) : "—"}`}>
        <a href={whatsappLink(user.phone)} target="_blank" rel="noopener noreferrer" className="ltr-nums text-sm underline">{formatIraqiPhone(user.phone)}</a>
      </AdminPageHeader>
      {canEdit ? (
        <Panel title={t("profile")} id="profile">
          <ActionForm action={updateCustomerAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={user.id} />
            <TextField id="name" name="name" label={tc("name")} defaultValue={user.name} required maxLength={80} wrapperClassName="w-64" />
            <SelectField id="status" name="status" label={t("accountStatus")} defaultValue={user.status}>
              <option value="ACTIVE">{t("ACTIVE")}</option>
              <option value="DISABLED">{t("DISABLED")}</option>
            </SelectField>
            <SubmitButton variant="secondary">{tc("save")}</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}
      <Panel title={t("orders")} id="orders">
        {orders.length === 0 ? <p className="text-sm text-muted">{tc("noResults")}</p> : (
          <ul className="divide-y divide-border text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/admin/orders/${o.id}`} className="ltr-nums font-semibold text-primary-text underline">{o.orderNumber}</Link>
                <Badge tone={orderStatusTone(o.status)}>{ts(`order.${o.status}`)}</Badge>
                <span>{formatDate(o.createdAt, lang)}</span>
                <span className="ltr-nums">{formatIQD(o.total, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={t("addresses")} id="addr">
        {addresses.length === 0 ? <p className="text-sm text-muted">{tc("none")}</p> : (
          <ul className="space-y-2 text-sm">
            {addresses.map((a) => <li key={a.id}>{a.fullName} · {a.city}, {a.district} · {a.addressLine}{a.landmark ? ` · ${a.landmark}` : ""}</li>)}
          </ul>
        )}
      </Panel>
      {canEdit ? (
        <Panel title={t("resetTitle")} id="reset">
          <p className="mb-3 text-sm text-muted">{t("resetText")}</p>
          <ActionForm action={createResetLinkAction}>
            <input type="hidden" name="id" value={user.id} />
            <SubmitButton variant="secondary">{t("generate")}</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}
      {hasPermission(admin.role, "customers.delete") ? (
        <Panel title={tc("delete")} id="delete">
          <ActionForm action={deleteCustomerAction}>
            <input type="hidden" name="id" value={user.id} />
            <p className="text-sm text-muted">{t("deleteHint")}</p>
            <SubmitButton variant="danger">{tc("confirmDelete")}</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}
