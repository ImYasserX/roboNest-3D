"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { UploadIcon } from "@/components/ui/icons";

export function AdminUploadButton({ productId, purpose, accept, label, hint }: { productId: string; purpose: "PRODUCT_IMAGE" | "PREVIEW_MODEL" | "DIGITAL_FILE"; accept: string; label: string; hint?: string }) {
  const t = useTranslations("admin.products.errors");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const id = `upload-${purpose}`;

  async function upload(files: FileList) {
    setState({ busy: true });
    const list = Array.from(files);
    for (const file of list) {
      const res = await fetch(`/api/admin/uploads?purpose=${purpose}&productId=${productId}&filename=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const code = body.error && t.has(body.error) ? body.error : "upload_failed";
        setState({ busy: false, error: t(code) });
        router.refresh();
        return;
      }
    }
    setState({ busy: false });
    router.refresh();
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-semibold hover:bg-surface-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus">
        <UploadIcon size={18} />
        {state.busy ? tc("loading") : label}
        <input id={id} type="file" accept={accept} multiple={purpose === "PRODUCT_IMAGE"} className="sr-only" disabled={state.busy} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files);
          e.target.value = "";
        }} />
      </label>
      {hint ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
      <p aria-live="polite" className="text-sm text-danger">{state.error}</p>
    </div>
  );
}
