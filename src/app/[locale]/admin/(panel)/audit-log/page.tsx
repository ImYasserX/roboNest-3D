import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/services/engagement";
import { formatDate } from "@/lib/localize";
import { Link } from "@/i18n/navigation";
import { DataTable } from "@/components/admin/table";
import { AdminPageHeader } from "@/components/admin/ui";
import { buttonClass } from "@/components/ui/button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/audit-log">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.audit" }))("title") };
}

export default async function AuditLogPage({ params, searchParams }: PageProps<"/[locale]/admin/audit-log">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "audit.view");
  const [t, tc, lang] = await Promise.all([getTranslations("admin.audit"), getTranslations("admin.common"), getLocale()]);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const result = await listAuditLogs(await getDb(), sp);
  return (
    <div>
      <AdminPageHeader title={t("title")} />
      <form action={`/${locale}/admin/audit-log`} method="get" className="mb-4 flex items-end gap-2">
        <div>
          <label htmlFor="action" className="mb-1 block text-xs text-muted">{t("filterAction")}</label>
          <input id="action" name="action" defaultValue={result.query.action} dir="ltr" placeholder="order.status.changed" className="rounded-md border border-border-strong bg-surface px-3 py-2" />
        </div>
        <button type="submit" className={buttonClass("secondary", "md")}>{tc("filter")}</button>
      </form>
      <DataTable
        caption={t("title")}
        empty={tc("noResults")}
        rows={result.rows}
        rowKey={(r) => r.id}
        columns={[
          { key: "d", header: tc("date"), cell: (r) => formatDate(r.createdAt, lang, true) },
          { key: "a", header: t("actor"), cell: (r) => r.actorLabel },
          { key: "x", header: t("action"), cell: (r) => <code dir="ltr" className="text-xs">{r.action}</code> },
          { key: "t", header: t("target"), cell: (r) => (r.targetType ? <span dir="ltr" className="text-xs">{r.targetType}:{r.targetId?.slice(0, 8)}</span> : tc("none")) },
          { key: "m", header: t("details"), cell: (r) => (r.metadata ? <code dir="ltr" className="block max-w-md whitespace-pre-wrap break-all text-xs text-muted">{JSON.stringify(r.metadata)}</code> : tc("none")) },
        ]}
      />
      {result.hasMore ? (
        <Link href={`/admin/audit-log?page=${result.page + 1}${result.query.action ? `&action=${result.query.action}` : ""}`} className={buttonClass("secondary", "md", "mt-4")}>
          {t("older")}
        </Link>
      ) : null}
    </div>
  );
}
