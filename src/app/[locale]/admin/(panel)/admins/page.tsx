import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { adminUsers } from "@/server/db/schema";
import { createAdminAction, resetAdminTotpAction, setAdminPasswordAction, updateAdminAction } from "@/server/actions/admin/manage";
import { ADMIN_ROLES } from "@/lib/domain";
import { formatDate } from "@/lib/localize";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/ui/field";
import { Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/admins">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.admins" }))("title") };
}

export default async function AdminsPage({ params }: PageProps<"/[locale]/admin/admins">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await requireAdminPage(locale, "admins.manage");
  const [t, tc, tr, lang] = await Promise.all([getTranslations("admin.admins"), getTranslations("admin.common"), getTranslations("admin.role"), getLocale()]);
  // Only the columns the UI needs: never password hashes or TOTP secrets.
  const admins = await (await getDb())
    .select({ id: adminUsers.id, username: adminUsers.username, displayName: adminUsers.displayName, role: adminUsers.role, status: adminUsers.status, totpEnabled: adminUsers.totpEnabled, lastLoginAt: adminUsers.lastLoginAt })
    .from(adminUsers)
    .orderBy(asc(adminUsers.createdAt));
  return (
    <div className="max-w-4xl space-y-6">
      <AdminPageHeader title={t("title")} />
      <ul className="space-y-3">
        {admins.map((a) => (
          <li key={a.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{a.displayName}</span>
              <span className="ltr-nums text-sm text-muted">@{a.username}</span>
              {a.id === me.id ? <span className="text-sm text-muted">{t("you")}</span> : null}
              <Badge tone="primary">{tr(a.role)}</Badge>
              <Badge tone={a.totpEnabled ? "success" : "warning"}>{t("totp")}: {a.totpEnabled ? tc("yes") : tc("no")}</Badge>
              <Badge tone={a.status === "ACTIVE" ? "success" : "danger"}>{a.status === "ACTIVE" ? tc("active") : tc("inactive")}</Badge>
              <span className="text-xs text-muted">{t("lastLogin")}: {a.lastLoginAt ? formatDate(a.lastLoginAt, lang, true) : "—"}</span>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-medium text-primary-text">{tc("edit")}</summary>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <ActionForm action={updateAdminAction} errorNamespace="admin.admins">
                  <input type="hidden" name="id" value={a.id} />
                  <TextField id={`dn-${a.id}`} name="displayName" label={t("displayName")} defaultValue={a.displayName} required maxLength={60} />
                  <SelectField id={`role-${a.id}`} name="role" label={t("role")} defaultValue={a.role}>
                    {ADMIN_ROLES.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
                  </SelectField>
                  <SelectField id={`status-${a.id}`} name="status" label={t("status")} defaultValue={a.status}>
                    <option value="ACTIVE">{tc("active")}</option>
                    <option value="DISABLED">{tc("inactive")}</option>
                  </SelectField>
                  <SubmitButton variant="secondary">{tc("save")}</SubmitButton>
                </ActionForm>
                <div className="space-y-4">
                  <ActionForm action={setAdminPasswordAction} errorNamespace="admin.admins">
                    <input type="hidden" name="id" value={a.id} />
                    <TextField id={`pw-${a.id}`} name="password" type="password" autoComplete="new-password" label={t("resetPassword")} hint={t("passwordHint")} minLength={12} required />
                    <SubmitButton variant="secondary">{t("resetPassword")}</SubmitButton>
                  </ActionForm>
                  {a.totpEnabled && a.id !== me.id ? (
                    <ActionForm action={resetAdminTotpAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <p className="text-sm text-muted">{t("resetTotpHint")}</p>
                      <SubmitButton variant="danger">{t("resetTotp")}</SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <Panel title={t("add")} id="add">
        <ActionForm action={createAdminAction} errorNamespace="admin.admins" className="grid gap-3 md:grid-cols-2">
          <TextField id="username" name="username" label={t("username")} hint={t("usernameHint")} required dir="ltr" autoCapitalize="none" maxLength={32} />
          <TextField id="displayName" name="displayName" label={t("displayName")} required maxLength={60} />
          <SelectField id="role" name="role" label={t("role")} defaultValue="OPERATIONS">
            {ADMIN_ROLES.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
          </SelectField>
          <TextField id="password" name="password" type="password" autoComplete="new-password" label={t("password")} hint={t("passwordHint")} required minLength={12} />
          <div><SubmitButton>{t("add")}</SubmitButton></div>
        </ActionForm>
      </Panel>
    </div>
  );
}
