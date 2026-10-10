import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listCustomRequestsAdmin } from "@/server/services/custom-print";
import { CUSTOM_REQUEST_STATUSES } from "@/lib/domain";
import { formatIQD } from "@/lib/money";
import { formatDate } from "@/lib/localize";
import { formatIraqiPhone } from "@/lib/phone";
import { Link } from "@/i18n/navigation";
import { DataTable } from "@/components/admin/table";
import { AdminPageHeader, AdminPagination, FilterBar } from "@/components/admin/ui";
import { Badge } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/custom-requests">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.customRequests" }))("title") };
}

export default async function CustomRequestsAdminPage({ params, searchParams }: PageProps<"/[locale]/admin/custom-requests">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "customRequests.manage");
  const [t, tc, ts, lang] = await Promise.all([getTranslations("admin.customRequests"), getTranslations("admin.common"), getTranslations("status"), getLocale()]);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const result = await listCustomRequestsAdmin(await getDb(), sp);
  return (
    <div>
      <AdminPageHeader title={t("title")} description={tc("results", { count: result.total })} />
      <FilterBar action={`/${locale}/admin/custom-requests`} q={result.query.q} placeholder={t("searchPlaceholder")} selects={[{ name: "status", label: tc("status"), value: result.query.status, options: CUSTOM_REQUEST_STATUSES.map((s) => [s, ts(`customRequest.${s}`)]) }]} />
      <DataTable
        caption={t("title")}
        empty={tc("noResults")}
        rows={result.rows}
        rowKey={(r) => r.id}
        columns={[
          { key: "n", header: "#", cell: (r) => <Link href={`/admin/custom-requests/${r.id}`} className="ltr-nums font-semibold text-primary-text underline">{r.requestNumber}</Link> },
          { key: "c", header: tc("name"), cell: (r) => <span>{r.customerName}<br /><span className="ltr-nums text-xs text-muted">{formatIraqiPhone(r.customerPhone)}</span></span> },
          { key: "m", header: t("material"), cell: (r) => `${r.material} ×${r.quantity}` },
          { key: "s", header: tc("status"), cell: (r) => <Badge tone={r.status === "SUBMITTED" ? "warning" : r.status === "ACCEPTED" ? "success" : r.status === "REJECTED" ? "danger" : "primary"}>{ts(`customRequest.${r.status}`)}</Badge> },
          { key: "q", header: t("quotedPrice"), align: "end", cell: (r) => (r.quotedPrice ? <span className="ltr-nums">{formatIQD(r.quotedPrice, lang)}</span> : tc("notSet")) },
          { key: "d", header: tc("date"), cell: (r) => formatDate(r.createdAt, lang, true) },
        ]}
      />
      <AdminPagination page={result.page} pageCount={result.pageCount} path="/admin/custom-requests" params={sp} />
    </div>
  );
}
