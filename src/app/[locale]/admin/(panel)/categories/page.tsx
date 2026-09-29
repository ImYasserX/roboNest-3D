import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { deleteCategoryAction, saveCategoryAction } from "@/server/actions/admin/manage";
import { getCategoryTree, type CategoryNode } from "@/server/services/catalog";
import { categoryProductCounts } from "@/server/services/categories";
import { hasPermission } from "@/lib/permissions";
import { pick } from "@/lib/localize";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/categories">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.categories" }))("title") };
}

export default async function CategoriesAdminPage({ params }: PageProps<"/[locale]/admin/categories">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "categories.edit");
  const [t, tc, lang] = await Promise.all([getTranslations("admin.categories"), getTranslations("admin.common"), getLocale()]);
  const db = await getDb();
  const [tree, counts] = await Promise.all([getCategoryTree(db, { includeInactive: true }), categoryProductCounts(db)]);
  const canDelete = hasPermission(admin.role, "categories.delete");

  const form = (c?: CategoryNode) => {
    const k = c?.id ?? "new";
    return (
      <ActionForm action={saveCategoryAction} errorNamespace="admin.categories" className="grid gap-3 md:grid-cols-3">
        {c ? <input type="hidden" name="id" value={c.id} /> : null}
        <TextField id={`slug-${k}`} name="slug" label={t("slug")} defaultValue={c?.slug} required dir="ltr" maxLength={80} />
        <TextField id={`en-${k}`} name="nameEn" label={t("nameEn")} defaultValue={c?.nameEn} required maxLength={80} />
        <TextField id={`ar-${k}`} name="nameAr" label={t("nameAr")} defaultValue={c?.nameAr} required maxLength={80} dir="rtl" />
        <SelectField id={`parent-${k}`} name="parentId" label={t("parent")} defaultValue={c?.parentId ?? ""}>
          <option value="">{t("noParent")}</option>
          {tree.roots.filter((r) => r.id !== c?.id).map((r) => <option key={r.id} value={r.id}>{pick(lang, r.nameEn, r.nameAr)}</option>)}
        </SelectField>
        <TextField id={`den-${k}`} name="descriptionEn" label={t("descriptionEn")} defaultValue={c?.descriptionEn} maxLength={500} />
        <TextField id={`dar-${k}`} name="descriptionAr" label={t("descriptionAr")} defaultValue={c?.descriptionAr} maxLength={500} dir="rtl" />
        <TextField id={`so-${k}`} name="sortOrder" type="number" min={0} label={tc("sortOrder")} defaultValue={String(c?.sortOrder ?? 0)} dir="ltr" />
        <CheckboxField id={`act-${k}`} name="isActive" label={tc("active")} defaultChecked={c ? c.isActive : true} className="self-end pb-2" />
        <div className="self-end"><SubmitButton>{c ? tc("save") : t("add")}</SubmitButton></div>
      </ActionForm>
    );
  };

  const row = (c: CategoryNode, depth: number) => (
    <li key={c.id} className="rounded-lg border border-border p-3" style={{ marginInlineStart: depth * 24 }}>
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2">
          <span className="font-semibold">{pick(lang, c.nameEn, c.nameAr)}</span>
          <span className="ltr-nums text-xs text-muted">/{c.slug}</span>
          <Badge>{t("products")}: {counts.get(c.id) ?? 0}</Badge>
          {!c.isActive ? <Badge tone="warning">{tc("inactive")}</Badge> : null}
        </summary>
        <div className="mt-3 space-y-3">
          {form(c)}
          {canDelete ? (
            <ActionForm action={deleteCategoryAction} errorNamespace="admin.categories">
              <input type="hidden" name="id" value={c.id} />
              <SubmitButton variant="danger" size="sm">{tc("delete")}</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </details>
    </li>
  );

  return (
    <div className="max-w-5xl space-y-6">
      <AdminPageHeader title={t("title")} />
      <Panel title={t("add")} id="add">{form()}</Panel>
      <ul className="space-y-2">
        {tree.roots.flatMap((r) => [row(r, 0), ...r.children.map((c) => row(c, 1))])}
      </ul>
    </div>
  );
}
