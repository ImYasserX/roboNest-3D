import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listCustomers } from "@/server/services/customers";
import { formatIQD } from "@/lib/money";
import { formatDate } from "@/lib/localize";
import { formatIraqiPhone } from "@/lib/phone";
import { Link } from "@/i18n/navigation";
import { DataTable } from "@/components/admin/table";
import { AdminPageHeader, AdminPagination, FilterBar } from "@/components/admin/ui";
import { Alert, Badge } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/customers">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.customers" }))("title") };
}

export default async function CustomersPage({ params, searchParams }: PageProps<"/[locale]/admin/customers">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "customers.view");
  const [t, tc, lang] = await Promise.all([getTranslations("admin.customers"), getTranslations("admin.common"), getLocale()]);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const result = await listCustomers(await getDb(), sp);
  return (
    <div>
      <AdminPageHeader title={t("title")} description={tc("results", { count: result.total })} />
      {sp.deleted ? <Alert tone="success" className="mb-4">{t("deleted")}</Alert> : null}
      <FilterBar action={`/${locale}/admin/customers`} q={result.query.q} placeholder={t("searchPlaceholder")} />
      <DataTable
        caption={t("title")}
        empty={tc("noResults")}
        rows={result.rows}
        rowKey={(r) => r.id}
        columns={[
          { key: "n", header: tc("name"), cell: (r) => <Link href={`/admin/customers/${r.id}`} className="font-semibold text-primary-text underline">{r.name}</Link> },
          { key: "p", header: tc("phone"), cell: (r) => <span className="ltr-nums">{formatIraqiPhone(r.phone)}</span> },
          { key: "s", header: tc("status"), cell: (r) => <Badge tone={r.status === "ACTIVE" ? "success" : "danger"}>{t(r.status)}</Badge> },
          { key: "o", header: t("orders"), align: "end", cell: (r) => <span className="ltr-nums">{r.orderCount}</span> },
          { key: "sp", header: t("spent"), align: "end", cell: (r) => <span className="ltr-nums">{formatIQD(r.totalSpent, lang)}</span> },
          { key: "j", header: t("joined"), cell: (r) => formatDate(r.createdAt, lang) },
        ]}
      />
      <AdminPagination page={result.page} pageCount={result.pageCount} path="/admin/customers" params={sp} />
    </div>
  );
}
