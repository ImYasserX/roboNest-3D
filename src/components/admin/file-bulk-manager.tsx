"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { bulkDeleteFilesAction, bulkSetFilesActiveAction, renameDigitalFileAction, type FileBulkState } from "@/server/actions/admin/products";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { PencilIcon, TrashIcon } from "@/components/ui/icons";
import { Alert, Badge } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";

export type FileRow = {
  id: string;
  filename: string;
  format: string;
  size: string;
  isActive: boolean;
  productId: string;
  productName: string;
  productStatus: string;
  entitled: number;
  paidBuyers: number;
  downloads: number;
  created: string;
};

const dialogClass = "m-auto w-[min(36rem,calc(100vw-2rem))] max-h-[90dvh] overflow-y-auto rounded-2xl border border-border-strong bg-surface p-0 text-text shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm";

/**
 * Original paid files with selection and guarded bulk actions. Statuses:
 * Active (buyers can download), Inactive (nobody can), and the number of
 * buyers entitled to each file. Nothing here can make a file public.
 */
export function FileBulkManager({ rows, canManage, canDelete }: { rows: FileRow[]; canManage: boolean; canDelete: boolean }) {
  const t = useTranslations("admin.digitalFiles");
  const tc = useTranslations("admin.common");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ids = rows.map((r) => r.id);
  const allOn = ids.length > 0 && ids.every((id) => picked.has(id));
  const selected = rows.filter((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clear = () => setPicked(new Set());
  const selectable = canManage || canDelete;

  return (
    <div className="space-y-3">
      {selectable && picked.size > 0 ? (
        <div role="region" aria-label={t("toolbar")} className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-surface/95 p-3 shadow-[var(--rn-glow)] backdrop-blur">
          <p className="me-auto text-sm font-semibold" aria-live="polite">{t("selected", { count: picked.size })}</p>
          {canManage ? <ActiveDialog ids={[...picked]} rows={selected} active onDone={clear} /> : null}
          {canManage ? <ActiveDialog ids={[...picked]} rows={selected} active={false} onDone={clear} /> : null}
          {canDelete ? <DeleteDialog ids={[...picked]} rows={selected} onDone={clear} /> : null}
          <button type="button" className={buttonClass("ghost", "sm")} onClick={clear}>{tc("clearSelection")}</button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong/50 bg-surface/50 p-10 text-center text-muted">{tc("noResults")}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--rn-shadow)]">
          <div className="md:overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("title")}</caption>
              <thead className="hidden border-b border-border bg-surface-2/70 md:table-header-group">
                <tr>
                  {selectable ? <th scope="col" className="w-10 px-4 py-3"><input type="checkbox" className="size-4 accent-primary" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(ids))} aria-label={t("selectPage")} /></th> : null}
                  <th scope="col" className="px-4 py-3 text-start">{t("file")}</th>
                  <th scope="col" className="px-4 py-3 text-start">{t("product")}</th>
                  <th scope="col" className="px-4 py-3 text-start">{tc("status")}</th>
                  <th scope="col" className="px-4 py-3 text-end">{t("buyers")}</th>
                  <th scope="col" className="px-4 py-3 text-end">{t("downloads")}</th>
                  <th scope="col" className="px-4 py-3 text-end"><span className="sr-only">{tc("actions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 p-3 md:table-row md:p-0", picked.has(r.id) ? "bg-primary-soft/60" : "hover:bg-surface-2/50")}>
                    {selectable ? <td className="row-span-6 md:table-cell md:px-4 md:py-3"><input type="checkbox" className="size-5 accent-primary md:size-4" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={t("selectOne", { name: r.filename })} /></td> : null}
                    <td className="md:px-4 md:py-3">
                      <span className="font-semibold" dir="ltr">{r.filename}</span>
                      <span className="block text-xs text-muted">{r.format} · {r.size} · {r.created}</span>
                    </td>
                    <td className="md:px-4 md:py-3"><Link href={`/admin/products/${r.productId}#files`} className="hover:text-primary-text hover:underline">{r.productName}</Link></td>
                    <td className="md:px-4 md:py-3">
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? t("statusActive") : t("statusInactive")}</Badge>
                        <Badge tone="info">{t("privateBadge")}</Badge>
                        {r.productStatus !== "PUBLISHED" ? <Badge tone="warning">{t("productNotPublished")}</Badge> : null}
                      </span>
                    </td>
                    <td className="ltr-nums md:px-4 md:py-3 md:text-end">{r.entitled}<span className="text-xs text-muted"> ({t("paid", { count: r.paidBuyers })})</span></td>
                    <td className="ltr-nums md:px-4 md:py-3 md:text-end">{r.downloads}</td>
                    <td className="col-start-2 md:px-4 md:py-3 md:text-end">{canManage ? <RenameDialog row={r} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


function Errors({ state, ns }: { state: FileBulkState; ns: "admin.digitalFiles" }) {
  const t = useTranslations(ns);
  const tc = useTranslations("admin.common");
  if (!state?.error) return null;
  return <Alert tone="danger">{state.error === "forbidden" || state.error === "unauthorized" ? tc(state.error) : t.has(`errors.${state.error}`) ? t(`errors.${state.error}`, { buyers: state.buyers ?? 0 }) : tc("error")}</Alert>;
}

function ActiveDialog({ ids, rows, active, onDone }: { ids: string[]; rows: FileRow[]; active: boolean; onDone: () => void }) {
  const t = useTranslations("admin.digitalFiles");
  const tc = useTranslations("admin.common");
  const d = useRef<HTMLDialogElement>(null);
  const [state, dispatch, pending] = useActionState<FileBulkState, FormData>(bulkSetFilesActiveAction, null);
  const [ack, setAck] = useState(false);
  const buyers = rows.filter((r) => r.isActive).reduce((n, r) => n + r.entitled, 0);
  useEffect(() => {
    if (state?.ok) {
      d.current?.close();
      onDone();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => {
    const fd = new FormData();
    fd.set("ids", JSON.stringify(ids));
    fd.set("active", active ? "1" : "0");
    if (ack) fd.set("acknowledge", "on");
    startTransition(() => dispatch(fd));
  };
  return (
    <>
      <button type="button" className={buttonClass("secondary", "sm")} onClick={() => { setAck(false); d.current?.showModal(); }}>{active ? t("activate") : t("deactivate")}</button>
      <dialog ref={d} aria-labelledby={`active-${active}`} className={dialogClass}>
        <div className="space-y-4 p-5 sm:p-6">
          <h2 id={`active-${active}`} className="font-display text-lg font-semibold">{active ? t("activateTitle", { count: ids.length }) : t("deactivateTitle", { count: ids.length })}</h2>
          <p className="text-sm text-muted">{active ? t("activateText") : t("deactivateText")}</p>
          {!active && buyers > 0 ? (
            <Alert tone="warning">
              <p>{t("buyersWarning", { buyers })}</p>
              <label className="mt-2 flex items-start gap-2 font-medium">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                {t("acknowledge")}
              </label>
            </Alert>
          ) : null}
          <Errors state={state} ns="admin.digitalFiles" />
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" className={buttonClass("ghost", "md")} onClick={() => d.current?.close()}>{tc("cancel")}</button>
            <button type="button" className={buttonClass(active ? "primary" : "danger", "md")} disabled={pending || (!active && buyers > 0 && !ack)} onClick={submit}>{active ? t("activate") : t("deactivate")}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function DeleteDialog({ ids, rows, onDone }: { ids: string[]; rows: FileRow[]; onDone: () => void }) {
  const t = useTranslations("admin.digitalFiles");
  const tc = useTranslations("admin.common");
  const d = useRef<HTMLDialogElement>(null);
  const [state, dispatch, pending] = useActionState<FileBulkState, FormData>(bulkDeleteFilesAction, null);
  const [text, setText] = useState("");
  const blocked = rows.filter((r) => r.entitled > 0 || r.downloads > 0);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <button type="button" className={buttonClass("danger", "sm")} onClick={() => { setText(""); d.current?.showModal(); }}><TrashIcon size={14} /> {t("delete")}</button>
      <dialog ref={d} aria-labelledby="files-delete" className={dialogClass}>
        <div className="space-y-4 p-5 sm:p-6">
          <h2 id="files-delete" className="font-display text-lg font-semibold">{t("deleteTitle", { count: ids.length })}</h2>
          <p className="text-sm text-muted">{t("deleteText")}</p>
          {state?.ok ? (
            <Alert tone="success">
              {t("deleteDone", { deleted: state.deleted ?? 0, kept: state.kept?.length ?? 0 })}
              {state.kept?.length ? <ul className="mt-1 list-disc ps-5">{state.kept.map((k) => <li key={k.id} dir="ltr">{k.filename}</li>)}</ul> : null}
            </Alert>
          ) : (
            <>
              {blocked.length ? <Alert tone="warning">{t("deleteBlocked", { count: blocked.length })}</Alert> : null}
              <Errors state={state} ns="admin.digitalFiles" />
              <label className="block text-sm font-medium">
                {t("typeDelete")}
                <input className={cn(controlClass, "mt-1")} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" dir="ltr" />
              </label>
            </>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" className={buttonClass("ghost", "md")} onClick={() => d.current?.close()}>{state?.ok ? tc("close") : tc("cancel")}</button>
            {!state?.ok ? (
              <button
                type="button"
                className={buttonClass("danger", "md")}
                disabled={text.trim() !== "DELETE" || pending}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("ids", JSON.stringify(ids));
                  fd.set("confirmText", text);
                  startTransition(() => dispatch(fd));
                }}
              >
                {t("deletePermanently")}
              </button>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}

function RenameDialog({ row }: { row: FileRow }) {
  const t = useTranslations("admin.digitalFiles");
  const tc = useTranslations("admin.common");
  const d = useRef<HTMLDialogElement>(null);
  const [state, dispatch, pending] = useActionState<FileBulkState, FormData>(renameDigitalFileAction, null);
  const [name, setName] = useState(row.filename);
  useEffect(() => {
    if (state?.ok) d.current?.close();
  }, [state]);
  return (
    <>
      <button type="button" className={buttonClass("secondary", "sm")} onClick={() => d.current?.showModal()} aria-label={`${t("rename")}: ${row.filename}`}><PencilIcon size={14} /> {t("rename")}</button>
      <dialog ref={d} aria-labelledby={`rename-${row.id}`} className={dialogClass}>
        <form
          className="space-y-4 p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData();
            fd.set("fileId", row.id);
            fd.set("filename", name);
            startTransition(() => dispatch(fd));
          }}
        >
          <h2 id={`rename-${row.id}`} className="font-display text-lg font-semibold">{t("renameTitle")}</h2>
          <p className="text-sm text-muted">{t("renameText")}</p>
          <Errors state={state} ns="admin.digitalFiles" />
          <input className={controlClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} dir="ltr" aria-label={t("file")} />
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" className={buttonClass("ghost", "md")} onClick={() => d.current?.close()}>{tc("cancel")}</button>
            <button type="submit" className={buttonClass("primary", "md")} disabled={pending}>{tc("save")}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
