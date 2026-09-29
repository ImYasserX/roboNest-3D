import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { categoryOptions } from "@/server/admin-categories";
import { getProductForEdit } from "@/server/services/product-admin";
import {
  archiveProductAction,
  deleteDigitalFileAction,
  deleteImageAction,
  deleteOptionAction,
  deleteOptionValueAction,
  deleteProductAction,
  moveImageAction,
  removePreviewAction,
  saveOptionAction,
  saveOptionValueAction,
  setDigitalFileActiveAction,
  updateImageAltAction,
} from "@/server/actions/admin/products";
import { OPTION_TYPES } from "@/lib/domain";
import { hasPermission } from "@/lib/permissions";
import { formatBytes, formatDate, mediaUrl, pick } from "@/lib/localize";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { ProductForm } from "@/components/admin/product-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { AdminUploadButton } from "@/components/admin/upload-button";
import { buttonClass } from "@/components/ui/button";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/products/[id]">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.products" }))("title") };
}

const joinLines = (items: { en: string; ar: string }[]) => items.map((i) => `${i.en} | ${i.ar}`).join("\n");

export default async function EditProductPage({ params, searchParams }: PageProps<"/[locale]/admin/products/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const admin = await requireAdminPage(locale, "products.view");
  const db = await getDb();
  const data = await getProductForEdit(db, id);
  if (!data) notFound();
  const { product: p, images, options, files, relatedSlugs, acceptsDigitalFiles } = data;
  const [t, tc, lang] = await Promise.all([getTranslations("admin.products"), getTranslations("admin.common"), getLocale()]);
  const canEdit = hasPermission(admin.role, "products.edit");
  const canDelete = hasPermission(admin.role, "products.delete");
  const canFiles = hasPermission(admin.role, "digitalFiles.manage");
  const created = (await searchParams).created === "1";
  const name = pick(lang, p.nameEn, p.nameAr);

  return (
    <div className="max-w-5xl space-y-6">
      <AdminPageHeader title={t("editTitle", { name })} description={`${tc("updated")}: ${formatDate(p.updatedAt, lang, true)}`}>
        {p.status === "PUBLISHED" ? (
          <Link href={`/products/${p.slug}`} className={buttonClass("secondary", "md")} target="_blank">
            {t("viewInStore")}
          </Link>
        ) : null}
      </AdminPageHeader>
      {created ? <Alert tone="success">{t("created")}</Alert> : null}

      {canEdit ? (
        <ProductForm
          id={p.id}
          categories={await categoryOptions(db, lang)}
          values={{
            ...p,
            materials: p.materials.join(", "),
            colors: p.colors.join(", "),
            tags: p.tags.join(", "),
            features: joinLines(p.features),
            included: joinLines(p.included),
            specifications: p.specifications.map((s) => `${s.label.en} | ${s.label.ar} | ${s.value.en} | ${s.value.ar}`).join("\n"),
            relatedSlugs: relatedSlugs.join(", "),
            createdAt: null,
            updatedAt: null,
            publishedAt: null,
          }}
        />
      ) : null}

      <Panel title={t("sections.media")} id="media">
        {canEdit ? <AdminUploadButton productId={p.id} purpose="PRODUCT_IMAGE" accept=".jpg,.jpeg,.png,.webp,.avif" label={t("images.upload")} hint={t("images.hint")} /> : null}
        {images.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("images.none")}</p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {images.map((img, i) => (
              <li key={img.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex gap-3">
                  <div className="relative size-24 shrink-0 overflow-hidden rounded-md bg-surface-2">
                    <Image src={mediaUrl(img.r2Key)} alt={pick(lang, img.altEn, img.altAr)} fill sizes="96px" className="object-cover" />
                  </div>
                  <div className="flex flex-wrap content-start gap-1.5">
                    {i === 0 ? <Badge tone="primary">{t("images.primary")}</Badge> : null}
                    {img.width && img.height ? <Badge className="ltr-nums">{img.width}×{img.height}</Badge> : null}
                    {canEdit ? (
                      <>
                        {i > 0 ? (
                          <form action={moveImageAction}>
                            <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="imageId" value={img.id} /><input type="hidden" name="direction" value="primary" />
                            <SubmitButton variant="ghost" size="sm">{t("images.makePrimary")}</SubmitButton>
                          </form>
                        ) : null}
                        {i > 0 ? (
                          <form action={moveImageAction}>
                            <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="imageId" value={img.id} /><input type="hidden" name="direction" value="up" />
                            <SubmitButton variant="ghost" size="sm" aria-label={t("images.moveUp")}>↑</SubmitButton>
                          </form>
                        ) : null}
                        {i < images.length - 1 ? (
                          <form action={moveImageAction}>
                            <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="imageId" value={img.id} /><input type="hidden" name="direction" value="down" />
                            <SubmitButton variant="ghost" size="sm" aria-label={t("images.moveDown")}>↓</SubmitButton>
                          </form>
                        ) : null}
                        <form action={deleteImageAction}>
                          <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="imageId" value={img.id} />
                          <SubmitButton variant="danger" size="sm">{tc("delete")}</SubmitButton>
                        </form>
                      </>
                    ) : null}
                  </div>
                </div>
                {canEdit ? (
                  <ActionForm action={updateImageAltAction} className="grid gap-2">
                    <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="imageId" value={img.id} />
                    <TextField id={`altEn-${img.id}`} name="altEn" label={t("images.altEn")} defaultValue={img.altEn} maxLength={160} />
                    <TextField id={`altAr-${img.id}`} name="altAr" label={t("images.altAr")} defaultValue={img.altAr} maxLength={160} dir="rtl" />
                    <SubmitButton variant="secondary" size="sm">{t("images.saveAlt")}</SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t("sections.preview")} id="preview">
        <p className="mb-3 text-sm">{p.previewModelKey ? t("preview.current") : t("preview.none")}</p>
        {canEdit ? (
          <div className="flex flex-wrap items-start gap-3">
            <AdminUploadButton productId={p.id} purpose="PREVIEW_MODEL" accept=".glb" label={t("preview.upload")} hint={t("preview.hint")} />
            {p.previewModelKey ? (
              <form action={removePreviewAction}>
                <input type="hidden" name="productId" value={p.id} />
                <SubmitButton variant="danger">{t("preview.remove")}</SubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel title={t("sections.files")} id="files">
        {!acceptsDigitalFiles ? (
          <p className="text-sm text-muted">{t("files.notDigital")}</p>
        ) : (
          <div className="space-y-3">
            {canFiles ? <AdminUploadButton productId={p.id} purpose="DIGITAL_FILE" accept=".stl,.3mf,.obj,.glb,.zip" label={t("files.upload")} hint={t("files.hint")} /> : null}
            {files.length === 0 ? (
              <p className="text-sm text-muted">{t("files.none")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span>
                      <span dir="ltr" className="font-medium">{f.filename}</span> <span className="text-muted">({f.format} · {formatBytes(f.sizeBytes, lang)} · {formatDate(f.createdAt, lang)})</span>{" "}
                      <Badge tone={f.isActive ? "success" : "neutral"}>{f.isActive ? tc("active") : tc("inactive")}</Badge>
                    </span>
                    <span className="flex gap-2">
                      {canFiles ? (
                        <form action={setDigitalFileActiveAction}>
                          <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="fileId" value={f.id} /><input type="hidden" name="active" value={f.isActive ? "0" : "1"} />
                          <SubmitButton variant="secondary" size="sm">{f.isActive ? t("files.deactivate") : t("files.activate")}</SubmitButton>
                        </form>
                      ) : null}
                      {canDelete ? (
                        <form action={deleteDigitalFileAction}>
                          <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="fileId" value={f.id} />
                          <SubmitButton variant="danger" size="sm">{tc("delete")}</SubmitButton>
                        </form>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      <Panel title={t("sections.options")} id="options">
        <div className="space-y-5">
          {options.length === 0 ? <p className="text-sm text-muted">{t("options.none")}</p> : null}
          {options.map((o) => (
            <div key={o.id} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {pick(lang, o.labelEn, o.labelAr)} <Badge>{t(`options.types.${o.type}`)}</Badge> {o.isRequired ? <Badge tone="warning">{tc("required")}</Badge> : null}
                </h3>
                {canEdit ? (
                  <ActionForm action={deleteOptionAction} className="">
                    <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="optionId" value={o.id} />
                    <SubmitButton variant="danger" size="sm">{t("options.deleteOption")}</SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
              {canEdit ? <OptionFields productId={p.id} option={o} t={t} tc={tc} /> : null}
              {["SELECT", "RADIO", "CHECKBOX"].includes(o.type) ? (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">{t("options.values")}</h4>
                  {o.values.map((v) => (
                    <div key={v.id} className="flex flex-wrap items-end gap-2 rounded-md bg-surface-2 p-2">
                      {canEdit ? (
                        <>
                          <ValueFields productId={p.id} optionId={o.id} value={v} t={t} tc={tc} />
                          <ActionForm action={deleteOptionValueAction} className="">
                            <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="optionId" value={o.id} /><input type="hidden" name="valueId" value={v.id} />
                            <SubmitButton variant="danger" size="sm">{tc("delete")}</SubmitButton>
                          </ActionForm>
                        </>
                      ) : (
                        <span className="text-sm">{pick(lang, v.labelEn, v.labelAr)}</span>
                      )}
                    </div>
                  ))}
                  {canEdit ? (
                    <details className="rounded-md border border-dashed border-border p-2">
                      <summary className="cursor-pointer text-sm font-medium text-primary-text">{t("options.addValue")}</summary>
                      <div className="mt-2"><ValueFields productId={p.id} optionId={o.id} t={t} tc={tc} /></div>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {canEdit ? (
            <details className="rounded-lg border border-dashed border-border-strong p-4">
              <summary className="cursor-pointer font-semibold text-primary-text">{t("options.add")}</summary>
              <div className="mt-3"><OptionFields productId={p.id} t={t} tc={tc} /></div>
            </details>
          ) : null}
        </div>
      </Panel>

      {canEdit ? (
        <Panel title={t("sections.danger")} id="danger">
          <div className="grid gap-4 md:grid-cols-2">
            <ActionForm action={archiveProductAction}>
              <input type="hidden" name="id" value={p.id} />
              <p className="text-sm text-muted">{t("archiveHint")}</p>
              <SubmitButton variant="secondary" disabled={p.status === "ARCHIVED"}>{t("archive")}</SubmitButton>
            </ActionForm>
            {canDelete ? (
              <ActionForm action={deleteProductAction} errorNamespace="admin.products">
                <input type="hidden" name="id" value={p.id} />
                <p className="text-sm text-muted">{t("deleteHint")}</p>
                <SubmitButton variant="danger">{tc("confirmDelete")}</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"admin.products">>>;
type TC = Awaited<ReturnType<typeof getTranslations<"admin.common">>>;
type OptionRow = NonNullable<Awaited<ReturnType<typeof getProductForEdit>>>["options"][number];

function OptionFields({ productId, option, t, tc }: { productId: string; option?: OptionRow; t: T; tc: TC }) {
  const key = option?.id ?? "new";
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return (
    <ActionForm action={saveOptionAction} errorNamespace="admin.products" className="grid gap-3 md:grid-cols-4">
      <input type="hidden" name="productId" value={productId} />
      {option ? <input type="hidden" name="optionId" value={option.id} /> : null}
      <SelectField id={`type-${key}`} name="type" label={t("options.type")} defaultValue={option?.type ?? "SELECT"}>
        {OPTION_TYPES.map((ty) => <option key={ty} value={ty}>{t(`options.types.${ty}`)}</option>)}
      </SelectField>
      <TextField id={`labelEn-${key}`} name="labelEn" label={t("options.labelEn")} defaultValue={option?.labelEn} required maxLength={80} />
      <TextField id={`labelAr-${key}`} name="labelAr" label={t("options.labelAr")} defaultValue={option?.labelAr} required maxLength={80} dir="rtl" />
      <CheckboxField id={`req-${key}`} name="isRequired" label={t("options.isRequired")} defaultChecked={option?.isRequired} className="self-end pb-2" />
      <TextField id={`helpEn-${key}`} name="helpEn" label={t("options.helpEn")} defaultValue={option?.helpEn} maxLength={200} wrapperClassName="md:col-span-2" />
      <TextField id={`helpAr-${key}`} name="helpAr" label={t("options.helpAr")} defaultValue={option?.helpAr} maxLength={200} dir="rtl" wrapperClassName="md:col-span-2" />
      <TextField id={`pd-${key}`} name="priceDelta" type="number" min={0} step={250} label={t("options.priceDelta")} hint={t("options.priceDeltaHint")} defaultValue={num(option?.priceDelta)} dir="ltr" />
      <TextField id={`ppu-${key}`} name="pricePerUnit" type="number" min={0} label={t("options.pricePerUnit")} hint={t("options.pricePerUnitHint")} defaultValue={num(option?.pricePerUnit)} dir="ltr" />
      <TextField id={`min-${key}`} name="minValue" type="number" min={0} label={t("options.minValue")} hint={t("options.minMaxHint")} defaultValue={num(option?.minValue)} dir="ltr" />
      <TextField id={`max-${key}`} name="maxValue" type="number" min={0} label={t("options.maxValue")} defaultValue={num(option?.maxValue)} dir="ltr" />
      <TextField id={`uen-${key}`} name="unitEn" label={t("options.unitEn")} defaultValue={option?.unitEn} maxLength={12} />
      <TextField id={`uar-${key}`} name="unitAr" label={t("options.unitAr")} defaultValue={option?.unitAr} maxLength={12} dir="rtl" />
      <TextField id={`so-${key}`} name="sortOrder" type="number" min={0} label={tc("sortOrder")} defaultValue={num(option?.sortOrder)} dir="ltr" />
      <div className="self-end"><SubmitButton variant={option ? "secondary" : "primary"}>{option ? tc("save") : t("options.add")}</SubmitButton></div>
    </ActionForm>
  );
}

function ValueFields({ productId, optionId, value, t, tc }: { productId: string; optionId: string; value?: OptionRow["values"][number]; t: T; tc: TC }) {
  const key = value?.id ?? `new-${optionId}`;
  return (
    <ActionForm action={saveOptionValueAction} errorNamespace="admin.products" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="optionId" value={optionId} />
      {value ? <input type="hidden" name="valueId" value={value.id} /> : null}
      <TextField id={`ven-${key}`} name="labelEn" label={t("options.valueLabelEn")} defaultValue={value?.labelEn} required maxLength={60} wrapperClassName="w-40" />
      <TextField id={`var-${key}`} name="labelAr" label={t("options.valueLabelAr")} defaultValue={value?.labelAr} required maxLength={60} dir="rtl" wrapperClassName="w-40" />
      <TextField id={`vpd-${key}`} name="priceDelta" type="number" min={0} step={250} label={t("options.priceDelta")} defaultValue={value ? String(value.priceDelta) : "0"} dir="ltr" wrapperClassName="w-32" />
      <TextField id={`vsw-${key}`} name="swatch" label={t("options.swatch")} defaultValue={value?.swatch ?? ""} placeholder="#7e22ce" maxLength={7} dir="ltr" wrapperClassName="w-28" />
      <TextField id={`vso-${key}`} name="sortOrder" type="number" min={0} label={tc("sortOrder")} defaultValue={value ? String(value.sortOrder) : "0"} dir="ltr" wrapperClassName="w-20" />
      <CheckboxField id={`vac-${key}`} name="isActive" label={tc("active")} defaultChecked={value ? value.isActive : true} className="pb-2" />
      <SubmitButton variant="secondary" size="sm" className="min-h-11">{value ? tc("save") : t("options.addValue")}</SubmitButton>
    </ActionForm>
  );
}
