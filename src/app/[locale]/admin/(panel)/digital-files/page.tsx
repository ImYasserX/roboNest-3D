import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { rejectPreviewAction } from "@/server/actions/admin/products";
import { DIGITAL_FILES_PAGE_SIZE, listDigitalFilesAdmin, listPreviewsAdmin } from "@/server/services/digital-file-admin";
import { DIGITAL_FORMATS, PREVIEW_STATUSES } from "@/lib/domain";
import { hasPermission } from "@/lib/permissions";
import { formatBytes, formatDate, pick } from "@/lib/localize";
import { Link } from "@/i18n/navigation";
import { FileBulkManager } from "@/components/admin/file-bulk-manager";
import { DataTable } from "@/components/admin/table";
import { AdminPageHeader, AdminPagination, AdminTabs, FilterBar } from "@/components/admin/ui";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/digital-files">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.digitalFiles" }))("title") };
}

export default async function DigitalFilesPage({ params, searchParams }: PageProps<"/[locale]/admin/digital-files">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "digitalFiles.manage");
  const [t, tp, tc, lang] = await Promise.all([getTranslations("admin.digitalFiles"), getTranslations("admin.products.preview"), getTranslations("admin.common"), getLocale()]);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const tab = sp.tab === "previews" ? "previews" : "files";
  const db = await getDb();
  const canApprove = hasPermission(admin.role, "previews.approve");

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("title")} description={t("text")} breadcrumbs={[{ label: tc("dashboard"), href: "/admin" }, { label: t("title") }]} />
      <AdminTabs
        label={t("title")}
        current={tab}
        tabs={[
          { value: "files", label: t("tabFiles"), href: "/admin/digital-files" },
          { value: "previews", label: t("tabPreviews"), href: "/admin/digital-files?tab=previews" },
        ]}
      />
      {tab === "files" ? <FilesTab sp={sp} lang={lang} canDelete={hasPermission(admin.role, "products.delete")} locale={locale} /> : null}
      {tab === "previews" ? (
        <>
          <Alert tone="info">{t("previewsExplain")}</Alert>
          <FilterBar action={`/${locale}/admin/digital-files`} hidden={{ tab: "previews" }} selects={[{ name: "status", label: tc("status"), value: sp.status, options: PREVIEW_STATUSES.map((s) => [s, tp(`status.${s}`)]) }]} />
          <DataTable
            caption={t("tabPreviews")}
            empty={tp("noCandidates")}
            rows={await listPreviewsAdmin(db, sp.status)}
            rowKey={(r) => r.id}
            columns={[
              { key: "p", header: t("product"), cell: (r) => <Link href={`/admin/products/${r.productId}#preview`} className="font-semibold hover:text-primary-text hover:underline">{pick(lang, r.productNameEn, r.productNameAr)}</Link> },
              { key: "s", header: tc("status"), cell: (r) => <Badge tone={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "neutral" : "warning"}>{tp(`status.${r.status}`)}</Badge> },
              { key: "o", header: t("source"), cell: (r) => tp(`source.${r.source}`) },
              { key: "t", header: t("triangles"), align: "end", cell: (r) => <span className="ltr-nums">{r.triangleCount.toLocaleString(lang)}{r.sourceTriangleCount ? <span className="text-xs text-muted"> / {r.sourceTriangleCount.toLocaleString(lang)}</span> : null}</span> },
              { key: "z", header: t("size"), align: "end", cell: (r) => formatBytes(r.sizeBytes, lang) },
              { key: "d", header: tc("date"), cell: (r) => formatDate(r.createdAt, lang) },
              {
                key: "a",
                header: tc("actions"),
                cell: (r) => (
                  <span className="inline-flex flex-wrap gap-2">
                    <Link href={`/admin/products/${r.productId}#preview`} className={buttonClass("secondary", "sm")}>{r.status === "PENDING_REVIEW" ? tp("review") : tc("open")}</Link>
                    {canApprove && r.status === "APPROVED" ? (
                      <form action={rejectPreviewAction}>
                        <input type="hidden" name="previewId" value={r.id} />
                        <input type="hidden" name="reason" value="withdrawn" />
                        <SubmitButton variant="ghost" size="sm">{tp("withdraw")}</SubmitButton>
                      </form>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}

async function FilesTab({ sp, lang, canDelete, locale }: { sp: Record<string, string | undefined>; lang: string; canDelete: boolean; locale: string }) {
  const [t, tc] = await Promise.all([getTranslations("admin.digitalFiles"), getTranslations("admin.common")]);
  const result = await listDigitalFilesAdmin(await getDb(), sp);
  return (
    <>
      <Alert tone="info">{t("filesExplain")}</Alert>
      <FilterBar
        action={`/${locale}/admin/digital-files`}
        q={result.query.q}
        placeholder={t("searchPlaceholder")}
        selects={[
          { name: "format", label: t("format"), value: result.query.format, options: DIGITAL_FORMATS.map((f) => [f, f]) },
          { name: "active", label: tc("status"), value: result.query.active, options: [["1", t("statusActive")], ["0", t("statusInactive")]] },
          { name: "sort", label: tc("sort"), value: result.query.sort, options: [["newest", t("sortNewest")], ["oldest", t("sortOldest")], ["name", tc("name")], ["size", t("size")], ["downloads", t("downloads")]] },
        ]}
      />
      <FileBulkManager
        canManage
        canDelete={canDelete}
        rows={result.rows.map((r) => ({
          id: r.id,
          filename: r.filename,
          format: r.format,
          size: formatBytes(r.sizeBytes, lang),
          isActive: r.isActive,
          productId: r.productId,
          productName: pick(lang, r.productNameEn, r.productNameAr),
          productStatus: r.productStatus,
          entitled: r.entitled,
          paidBuyers: r.paidBuyers,
          downloads: r.downloads,
          created: formatDate(r.createdAt, lang),
        }))}
      />
      <AdminPagination page={result.page} pageCount={result.pageCount} path="/admin/digital-files" params={sp} total={result.total} pageSize={DIGITAL_FILES_PAGE_SIZE} />
    </>
  );
}
