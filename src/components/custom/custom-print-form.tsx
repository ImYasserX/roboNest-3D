"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { submitCustomRequestAction } from "@/server/actions/custom-print";
import { formatBytes, pick } from "@/lib/localize";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { CheckIcon, TrashIcon, UploadIcon } from "@/components/ui/icons";

type Choice = { code: string; en: string; ar: string };
type FileState = { key: string; name: string; size: number; state: "uploading" | "done" | "error"; id?: string; error?: string };

const MAX_FILES = 5;
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED = ["stl", "3mf", "obj", "zip"];

export function CustomPrintForm({ materials, colors, initialName, initialPhone }: { materials: Choice[]; colors: Choice[]; initialName: string; initialPhone: string }) {
  const t = useTranslations("custom");
  const tc = useTranslations("common");
  const tco = useTranslations("checkout");
  const locale = useLocale();
  const router = useRouter();
  const [files, setFiles] = useState<FileState[]>([]);
  const [values, setValues] = useState({ fullName: initialName, phone: initialPhone, material: materials[0]?.code ?? "", color: colors[0]?.code ?? "", scalePercent: "100", quantity: "1", notes: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function addFiles(list: FileList) {
    setFormError(null);
    const incoming = Array.from(list).slice(0, MAX_FILES - files.length);
    if (list.length + files.length > MAX_FILES) setFormError(t("errors.too_many_files"));
    for (const file of incoming) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED.includes(ext) || file.size > MAX_BYTES) {
        setFiles((f) => [...f, { key, name: file.name, size: file.size, state: "error", error: file.size > MAX_BYTES ? "too_large" : "bad_extension" }]);
        continue;
      }
      setFiles((f) => [...f, { key, name: file.name, size: file.size, state: "uploading" }]);
      try {
        const res = await fetch(`/api/uploads?purpose=CUSTOM_PRINT&filename=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
        const body = (await res.json()) as { id?: string; error?: string };
        setFiles((f) => f.map((x) => (x.key === key ? (res.ok && body.id ? { ...x, state: "done", id: body.id } : { ...x, state: "error", error: body.error ?? "upload_failed" }) : x)));
      } catch {
        setFiles((f) => f.map((x) => (x.key === key ? { ...x, state: "error", error: "upload_failed" } : x)));
      }
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const uploadIds = files.filter((f) => f.state === "done" && f.id).map((f) => f.id!);
    if (uploadIds.length === 0) {
      setErrors(["files"]);
      setFormError(t("errors.invalid_upload"));
      return;
    }
    startTransition(async () => {
      const res = await submitCustomRequestAction({ ...values, uploadIds });
      if (res.ok) {
        router.push(res.url);
        return;
      }
      setErrors(res.fields ?? []);
      setFormError(res.error === "rate_limited" ? tc("rateLimited") : t(`errors.${res.error === "invalid_upload" ? "invalid_upload" : "invalid_input"}`));
    });
  }

  const fileErrorText = (code?: string) => t(`errors.${code && ["too_large", "bad_extension", "type_mismatch", "too_many_files"].includes(code) ? code : "upload_failed"}`);
  const has = (f: string) => errors.includes(f);

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">{t("files")} <span className="text-danger" aria-hidden="true">*</span></legend>
        <p id="files-hint" className="text-sm text-muted">{t("filesHint")}</p>
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-strong bg-surface-2 p-4 text-center hover:border-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus">
          <UploadIcon size={28} className="text-primary-text" />
          <span className="font-semibold">{t("chooseFiles")}</span>
          <span className="text-sm text-muted">{t("dropHint")}</span>
          <input
            type="file"
            multiple
            accept=".stl,.3mf,.obj,.zip"
            className="sr-only"
            aria-describedby="files-hint"
            aria-invalid={has("files") ? true : undefined}
            disabled={files.length >= MAX_FILES}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {files.length ? (
          <ul className="space-y-2" aria-live="polite">
            {files.map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium" dir="ltr">{f.name}</span>
                  <span className={f.state === "error" ? "text-danger" : "text-muted"}>
                    {f.state === "uploading" ? t("fileUploading", { name: f.name }) : f.state === "done" ? <><CheckIcon size={14} className="inline text-success" /> {formatBytes(f.size, locale)}</> : `⚠ ${fileErrorText(f.error)}`}
                  </span>
                </span>
                <Button variant="ghost" size="sm" aria-label={t("fileRemove", { name: f.name })} onClick={() => setFiles((all) => all.filter((x) => x.key !== f.key))}>
                  <TrashIcon size={16} />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id="material" label={t("material")} required value={values.material} onChange={set("material")} error={has("material") ? t("errors.invalid_input") : undefined}>
          {materials.map((m) => <option key={m.code} value={m.code}>{pick(locale, m.en, m.ar)}</option>)}
        </SelectField>
        <SelectField id="color" label={t("color")} required value={values.color} onChange={set("color")} error={has("color") ? t("errors.invalid_input") : undefined}>
          {colors.map((c) => <option key={c.code} value={c.code}>{pick(locale, c.en, c.ar)}</option>)}
        </SelectField>
        <TextField id="scalePercent" label={t("scale")} type="number" inputMode="numeric" min={10} max={500} required value={values.scalePercent} onChange={set("scalePercent")} hint={t("scaleHint")} error={has("scalePercent") ? t("errors.invalid_input") : undefined} />
        <TextField id="quantity" label={t("quantity")} type="number" inputMode="numeric" min={1} max={100} required value={values.quantity} onChange={set("quantity")} error={has("quantity") ? t("errors.invalid_input") : undefined} />
        <TextAreaField id="notes" label={t("notes")} optionalLabel={tc("optional")} wrapperClassName="sm:col-span-2" value={values.notes} onChange={set("notes")} hint={t("notesHint")} maxLength={2000} />
      </div>

      <fieldset className="space-y-4">
        <legend className="mb-1 font-semibold">{t("yourDetails")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="fullName" label={t("fullName")} required autoComplete="name" value={values.fullName} onChange={set("fullName")} maxLength={80} error={has("fullName") ? t("errors.invalid_input") : undefined} />
          <TextField id="phone" label={t("phone")} required type="tel" inputMode="tel" dir="ltr" autoComplete="tel" value={values.phone} onChange={set("phone")} maxLength={24} error={has("phone") ? tco("errors.invalid_phone") : undefined} />
        </div>
      </fieldset>

      <button type="submit" disabled={pending || files.some((f) => f.state === "uploading")} className="flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-6 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60 sm:w-auto">
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
