import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listAllDigitalFiles } from "@/server/services/product-admin";
import { formatBytes, pick } from "@/lib/localize";
import { Link } from "@/i18n/navigation";
import { DataTable } from "@/components/admin/table";
import { AdminPageHeader } from "@/components/admin/ui";
import { Badge } from "@/components/ui/misc";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/digital-files">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.digitalFiles" }))("title") };
}

export default async function DigitalFilesPage({ params }: PageProps<"/[locale]/admin/digital-files">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "digitalFiles.manage");
  const [t, tc, lang] = await Promise.all([getTranslations("admin.digitalFiles"), getTranslations("admin.common"), getLocale()]);
  const rows = await listAllDigitalFiles(await getDb());
  return (
    <div>
      <AdminPageHeader title={t("title")} description={t("text")} />
      <DataTable
        caption={t("title")}
        empty={tc("noResults")}
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: "f", header: t("file"), cell: (r) => <span dir="ltr">{r.filename}</span> },
          { key: "p", header: t("product"), cell: (r) => <Link href={`/admin/products/${r.productId}#files`} className="text-primary-text underline">{pick(lang, r.productNameEn, r.productNameAr)}</Link> },
          { key: "s", header: t("size"), cell: (r) => `${r.format} · ${formatBytes(r.sizeBytes, lang)}` },
          { key: "a", header: tc("status"), cell: (r) => <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? tc("active") : tc("inactive")}</Badge> },
          { key: "d", header: t("downloads"), align: "end", cell: (r) => <span className="ltr-nums">{r.downloads}</span> },
        ]}
      />
    </div>
  );
}
