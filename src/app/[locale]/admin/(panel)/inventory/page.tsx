import type { Metadata } from "next";
import { asc, ne } from "drizzle-orm";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { products } from "@/server/db/schema";
import { updateInventoryAction } from "@/server/actions/admin/products";
import { AVAILABILITY } from "@/lib/domain";
import { pick } from "@/lib/localize";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader } from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/ui/field";
import { Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/inventory">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.inventory" }))("title") };
}

export default async function InventoryPage({ params }: PageProps<"/[locale]/admin/inventory">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "inventory.edit");
  const [t, ts, tf, lang] = await Promise.all([getTranslations("admin.inventory"), getTranslations("status"), getTranslations("admin.products.fields"), getLocale()]);
  const rows = await (await getDb())
    .select({ id: products.id, nameEn: products.nameEn, nameAr: products.nameAr, productType: products.productType, availability: products.availability, stockQuantity: products.stockQuantity, status: products.status })
    .from(products)
    .where(ne(products.status, "ARCHIVED"))
    .orderBy(asc(products.availability), asc(products.stockQuantity), asc(products.nameEn));
  return (
    <div className="max-w-5xl space-y-4">
      <AdminPageHeader title={t("title")} description={t("text")} />
      <ul className="space-y-2">
        {rows.map((r) => {
          const low = r.availability === "IN_STOCK" && (r.stockQuantity ?? 0) <= 5;
          return (
            <li key={r.id} className="rounded-xl border border-border bg-surface p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Link href={`/admin/products/${r.id}`} className="font-semibold underline">{pick(lang, r.nameEn, r.nameAr)}</Link>
                {low ? <Badge tone="danger">{t("lowStock")}</Badge> : null}
              </div>
              <ActionForm action={updateInventoryAction} errorNamespace="admin.products" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={r.id} />
                <SelectField id={`av-${r.id}`} name="availability" label={tf("availability")} defaultValue={r.availability} wrapperClassName="w-56">
                  {AVAILABILITY.filter((a) => (r.productType === "DIGITAL") === (a === "DIGITAL")).map((a) => <option key={a} value={a}>{ts(`availability.${a}`)}</option>)}
                </SelectField>
                <TextField id={`st-${r.id}`} name="stockQuantity" type="number" min={0} label={tf("stockQuantity")} defaultValue={r.stockQuantity === null ? "" : String(r.stockQuantity)} dir="ltr" wrapperClassName="w-32" disabled={r.productType === "DIGITAL"} />
                <SubmitButton variant="secondary">{t("update")}</SubmitButton>
              </ActionForm>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
