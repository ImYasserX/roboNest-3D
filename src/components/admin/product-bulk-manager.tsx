"use client";

import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { bulkDeleteProductsAction, bulkUpdateProductsAction, previewBulkDeleteAction, type BulkState } from "@/server/actions/admin/products";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { PencilIcon, TrashIcon } from "@/components/ui/icons";
import { Alert, Badge } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";

export type BulkRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  type: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  statusLabel: string;
  availability: string;
  price: string;
  updated: string;
  featured: boolean;
};
type Option = { value: string; label: string };

type Selection = { mode: "ids"; ids: string[] } | { mode: "filter"; filter: Record<string, string> };

type Field = "status" | "categoryId" | "availability" | "stockQuantity" | "isFeatured" | "tags" | "materials" | "price" | "clearSale";

/**
 * Products table with selection and bulk actions. The page renders it with a
 * `key` per filter + page, so a new result set always starts a new selection. The server resolves the
 * selection again (ids or the current filters), validates every change, and
 * enforces permissions; this component only collects intent and shows the
 * review step and the server's result.
 */
export function ProductBulkManager({
  rows,
  total,
  filter,
  maxBulk,
  canEdit,
  canDelete,
  options,
}: {
  rows: BulkRow[];
  total: number;
  filter: Record<string, string>;
  maxBulk: number;
  canEdit: boolean;
  canDelete: boolean;
  options: { statuses: Option[]; categories: Option[]; availability: Option[] };
}) {
  const t = useTranslations("admin.products.bulk");
  const tc = useTranslations("admin.common");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  // Result of the last bulk action; kept here because the toolbar (and its
  // dialogs) disappears once the selection is cleared.
  const [notice, setNotice] = useState<string | null>(null);
  const selectable = canEdit || canDelete;
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const count = allMatching ? total : picked.size;
  const selection: Selection = allMatching ? { mode: "filter", filter } : { mode: "ids", ids: [...picked] };
  const selectedNames = allMatching ? [] : rows.filter((r) => picked.has(r.id)).map((r) => r.name);

  const toggle = (id: string) => {
    setAllMatching(false);
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const togglePage = () => {
    setAllMatching(false);
    setPicked(allOnPage ? new Set() : new Set(pageIds));
  };
  const clear = () => {
    setPicked(new Set());
    setAllMatching(false);
  };
  const finished = (message: string) => {
    setNotice(message);
    clear();
  };

  return (
    <div className="space-y-3">
      {notice ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-success/40 bg-success-soft px-3 py-2 text-sm font-medium" data-testid="bulk-notice">
          <span>{notice}</span>
          <button type="button" className="text-xs underline" onClick={() => setNotice(null)}>{tc("close")}</button>
        </div>
      ) : null}
      {selectable && count > 0 ? (
        <div role="region" aria-label={t("toolbar")} className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-surface/95 p-3 shadow-[var(--rn-glow)] backdrop-blur" data-testid="bulk-toolbar">
          <p className="me-auto text-sm font-semibold" aria-live="polite">{t("selected", { count })}</p>
          {canEdit ? <BulkEditDialog selection={selection} count={count} names={selectedNames} options={options} onDone={finished} /> : null}
          {canDelete ? <BulkDeleteDialog selection={selection} count={count} onDone={finished} /> : null}
          <button type="button" className={buttonClass("ghost", "sm")} onClick={clear}>{t("clear")}</button>
        </div>
      ) : null}

      {selectable && allOnPage && total > rows.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" data-testid="select-all-matching">
          {allMatching ? (
            <>
              <span>{t("allMatchingSelected", { count: total })}</span>
              <button type="button" className="font-semibold text-primary-text underline" onClick={clear}>{t("clear")}</button>
            </>
          ) : (
            <>
              <span>{t("pageSelected", { count: rows.length })}</span>
              {total <= maxBulk ? (
                <button type="button" className="font-semibold text-primary-text underline" onClick={() => setAllMatching(true)}>{t("selectAllMatching", { count: total })}</button>
              ) : (
                <span className="text-muted">{t("tooManyToSelect", { max: maxBulk })}</span>
              )}
            </>
          )}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong/50 bg-surface/50 p-10 text-center text-muted">{tc("noResults")}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--rn-shadow)]">
          <div className="md:overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("caption")}</caption>
              <thead className="hidden border-b border-border bg-surface-2/70 md:table-header-group">
                <tr>
                  {selectable ? (
                    <th scope="col" className="w-10 px-4 py-3">
                      <input type="checkbox" className="size-4 accent-primary" checked={allOnPage} onChange={togglePage} aria-label={t("selectPage")} />
                    </th>
                  ) : null}
                  <th scope="col" className="px-4 py-3 text-start">{tc("name")}</th>
                  <th scope="col" className="px-4 py-3 text-start">{t("category")}</th>
                  <th scope="col" className="px-4 py-3 text-start">{tc("status")}</th>
                  <th scope="col" className="px-4 py-3 text-start">{t("stock")}</th>
                  <th scope="col" className="px-4 py-3 text-end">{t("price")}</th>
                  <th scope="col" className="px-4 py-3 text-start">{tc("updated")}</th>
                  <th scope="col" className="px-4 py-3 text-end"><span className="sr-only">{tc("actions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {selectable ? (
                  <tr className="block p-3 md:hidden">
                    <td>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" className="size-5 accent-primary" checked={allOnPage} onChange={togglePage} />
                        {t("selectPage")}
                      </label>
                    </td>
                  </tr>
                ) : null}
                {rows.map((r) => {
                  const on = allMatching || picked.has(r.id);
                  return (
                    <tr key={r.id} className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 p-3 md:table-row md:p-0", on ? "bg-primary-soft/60" : "hover:bg-surface-2/50")} data-product-row={r.slug}>
                      {selectable ? (
                        <td className="row-span-6 pt-0.5 md:table-cell md:px-4 md:py-3">
                          <input type="checkbox" className="size-5 accent-primary md:size-4" checked={on} onChange={() => toggle(r.id)} aria-label={t("selectOne", { name: r.name })} />
                        </td>
                      ) : null}
                      <td className="md:px-4 md:py-3">
                        <Link href={`/admin/products/${r.id}`} className="font-semibold hover:text-primary-text hover:underline">{r.name}</Link>
                        <span className="block text-xs text-muted" dir="ltr">{r.slug}</span>
                        {r.featured ? <Badge tone="primary" className="mt-1">{t("featured")}</Badge> : null}
                      </td>
                      <td className="text-muted md:px-4 md:py-3 md:text-text">{r.category} <span className="text-xs text-muted">· {r.type}</span></td>
                      <td className="md:px-4 md:py-3"><Badge tone={r.status === "PUBLISHED" ? "success" : r.status === "DRAFT" ? "warning" : "neutral"}>{r.statusLabel}</Badge></td>
                      <td className="text-muted md:px-4 md:py-3 md:text-text">{r.availability}</td>
                      <td className="ltr-nums font-semibold md:px-4 md:py-3 md:text-end">{r.price}</td>
                      <td className="text-xs text-muted md:px-4 md:py-3 md:text-sm">{r.updated}</td>
                      <td className="col-start-2 md:px-4 md:py-3 md:text-end">
                        <span className="inline-flex flex-wrap gap-2">
                          <Link href={`/admin/products/${r.id}`} className={buttonClass("secondary", "sm")} aria-label={`${t("edit")}: ${r.name}`}>
                            <PencilIcon size={14} /> {t("edit")}
                          </Link>
                          {r.status === "PUBLISHED" ? (
                            <Link href={`/products/${r.slug}`} target="_blank" className={buttonClass("ghost", "sm")}>{t("view")}</Link>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------


const dialogClass = "m-auto w-[min(40rem,calc(100vw-2rem))] max-h-[90dvh] overflow-y-auto rounded-2xl border border-border-strong bg-surface p-0 text-text shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm";

function csv(value: string) {
  return [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
}

function BulkEditDialog({ selection, count, names, options, onDone }: { selection: Selection; count: number; names: string[]; options: { statuses: Option[]; categories: Option[]; availability: Option[] }; onDone: (message: string) => void }) {
  const t = useTranslations("admin.products.bulk");
  const tc = useTranslations("admin.common");
  const te = useTranslations("admin.products.errors");
  const d = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"choose" | "review">("choose");
  const [on, setOn] = useState<Partial<Record<Field, boolean>>>({});
  const [v, setV] = useState({ status: options.statuses[0]?.value ?? "", categoryId: options.categories[0]?.value ?? "", availability: options.availability[0]?.value ?? "", stockQuantity: "0", isFeatured: "true", addTags: "", removeTags: "", addMaterials: "", removeMaterials: "", pricePercent: "10" });
  const [state, dispatch, pending] = useActionState<BulkState, FormData>(bulkUpdateProductsAction, null);

  const edit = useMemo(() => {
    const e: Record<string, unknown> = {};
    if (on.status) e.status = v.status;
    if (on.categoryId) e.categoryId = v.categoryId;
    if (on.availability) e.availability = v.availability;
    if (on.stockQuantity) e.stockQuantity = Number(v.stockQuantity);
    if (on.isFeatured) e.isFeatured = v.isFeatured === "true";
    if (on.tags) {
      if (csv(v.addTags).length) e.addTags = csv(v.addTags);
      if (csv(v.removeTags).length) e.removeTags = csv(v.removeTags);
    }
    if (on.materials) {
      if (csv(v.addMaterials).length) e.addMaterials = csv(v.addMaterials);
      if (csv(v.removeMaterials).length) e.removeMaterials = csv(v.removeMaterials);
    }
    if (on.price && Number(v.pricePercent)) e.pricePercent = Math.trunc(Number(v.pricePercent));
    if (on.clearSale) e.clearSalePrice = true;
    return e;
  }, [on, v]);

  const label = (opts: Option[], value: string) => opts.find((o) => o.value === value)?.label ?? value;
  const summary: string[] = [];
  if ("status" in edit) summary.push(`${t("fields.status")}: ${label(options.statuses, v.status)}`);
  if ("categoryId" in edit) summary.push(`${t("fields.categoryId")}: ${label(options.categories, v.categoryId)}`);
  if ("availability" in edit) summary.push(`${t("fields.availability")}: ${label(options.availability, v.availability)}`);
  if ("stockQuantity" in edit) summary.push(`${t("fields.stockQuantity")}: ${v.stockQuantity}`);
  if ("isFeatured" in edit) summary.push(`${t("fields.isFeatured")}: ${v.isFeatured === "true" ? tc("yes") : tc("no")}`);
  if (edit.addTags) summary.push(`${t("fields.addTags")}: ${(edit.addTags as string[]).join(", ")}`);
  if (edit.removeTags) summary.push(`${t("fields.removeTags")}: ${(edit.removeTags as string[]).join(", ")}`);
  if (edit.addMaterials) summary.push(`${t("fields.addMaterials")}: ${(edit.addMaterials as string[]).join(", ")}`);
  if (edit.removeMaterials) summary.push(`${t("fields.removeMaterials")}: ${(edit.removeMaterials as string[]).join(", ")}`);
  if ("pricePercent" in edit) summary.push(t("pricePercentSummary", { percent: Number(edit.pricePercent) > 0 ? `+${edit.pricePercent}` : String(edit.pricePercent) }));
  if ("clearSalePrice" in edit) summary.push(t("fields.clearSale"));

  useEffect(() => {
    if (state?.ok) {
      d.current?.close();
      setStep("choose");
      setOn({});
      onDone(t("updated", { updated: state.updated ?? 0, unchanged: state.unchanged ?? 0 }));
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const fd = new FormData();
    fd.set("selection", JSON.stringify(selection));
    fd.set("edit", JSON.stringify(edit));
    startTransition(() => dispatch(fd));
  };
  const check = (f: Field) => (
    <input type="checkbox" className="size-4 accent-primary" checked={Boolean(on[f])} onChange={(e) => setOn((o) => ({ ...o, [f]: e.target.checked }))} aria-label={t("changeField", { field: t(`fields.${f === "tags" ? "addTags" : f === "materials" ? "addMaterials" : f === "price" ? "pricePercent" : f}`) })} />
  );
  const row = (f: Field, title: string, control: React.ReactNode) => (
    <div className={cn("grid grid-cols-[auto_1fr] items-start gap-3 rounded-lg border p-3", on[f] ? "border-primary/50 bg-primary-soft/40" : "border-border")}>
      <div className="pt-1">{check(f)}</div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">{title}</p>
        {on[f] ? control : null}
      </div>
    </div>
  );
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const select = (k: keyof typeof v, opts: Option[], aria: string) => (
    <select className={controlClass} value={v[k]} onChange={set(k)} aria-label={aria}>
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <>
      <button type="button" className={buttonClass("primary", "sm")} onClick={() => d.current?.showModal()}>
        <PencilIcon size={14} /> {t("editSelected")}
      </button>
      <dialog ref={d} aria-labelledby="bulk-edit-title" className={dialogClass} onClose={() => setStep("choose")}>
        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <h2 id="bulk-edit-title" className="font-display text-lg font-semibold">{step === "choose" ? t("editTitle", { count }) : t("reviewTitle", { count })}</h2>
            <p className="text-sm text-muted">{step === "choose" ? t("editHelp") : t("reviewHelp")}</p>
          </div>
          {state?.error ? (
            <Alert tone="danger" title={state.error === "validation_failed" ? t("validationFailed") : undefined}>
              {state.error === "validation_failed" ? (
                <ul className="list-disc ps-5">
                  {state.problems?.slice(0, 10).map((p) => <li key={p.id}>{p.name}: {te.has(p.error) ? te(p.error) : p.error}</li>)}
                  {(state.problems?.length ?? 0) > 10 ? <li>{t("andMore", { count: (state.problems?.length ?? 0) - 10 })}</li> : null}
                </ul>
              ) : state.error === "forbidden" || state.error === "unauthorized" ? tc(state.error) : t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : tc("error")}
            </Alert>
          ) : null}
          {step === "choose" ? (
            <div className="space-y-2">
              {row("status", t("fields.status"), select("status", options.statuses, t("fields.status")))}
              {row("categoryId", t("fields.categoryId"), select("categoryId", options.categories, t("fields.categoryId")))}
              {row("availability", t("fields.availability"), select("availability", options.availability, t("fields.availability")))}
              {row("stockQuantity", t("fields.stockQuantity"), <input type="number" min={0} className={controlClass} value={v.stockQuantity} onChange={set("stockQuantity")} aria-label={t("fields.stockQuantity")} dir="ltr" />)}
              {row("isFeatured", t("fields.isFeatured"), select("isFeatured", [{ value: "true", label: tc("yes") }, { value: "false", label: tc("no") }], t("fields.isFeatured")))}
              {row("tags", t("fields.tags"), (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className={controlClass} value={v.addTags} onChange={set("addTags")} placeholder={t("fields.addTags")} aria-label={t("fields.addTags")} />
                  <input className={controlClass} value={v.removeTags} onChange={set("removeTags")} placeholder={t("fields.removeTags")} aria-label={t("fields.removeTags")} />
                </div>
              ))}
              {row("materials", t("fields.materials"), (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className={controlClass} value={v.addMaterials} onChange={set("addMaterials")} placeholder={t("fields.addMaterials")} aria-label={t("fields.addMaterials")} />
                  <input className={controlClass} value={v.removeMaterials} onChange={set("removeMaterials")} placeholder={t("fields.removeMaterials")} aria-label={t("fields.removeMaterials")} />
                </div>
              ))}
              {row("price", t("fields.pricePercent"), (
                <div className="flex items-center gap-2">
                  <input type="number" min={-90} max={500} step={1} className={cn(controlClass, "w-28")} value={v.pricePercent} onChange={set("pricePercent")} aria-label={t("fields.pricePercent")} dir="ltr" />
                  <span className="text-sm text-muted">{t("pricePercentHint")}</span>
                </div>
              ))}
              {row("clearSale", t("fields.clearSale"), <p className="text-sm text-muted">{t("clearSaleHint")}</p>)}
            </div>
          ) : (
            <div className="space-y-3">
              <ul className="list-disc space-y-1 rounded-lg border border-border bg-bg p-3 ps-8 text-sm" data-testid="bulk-review">
                {summary.map((s) => <li key={s}>{s}</li>)}
              </ul>
              <p className="text-sm">{t("reviewUnchanged")}</p>
              {names.length ? (
                <p className="text-xs text-muted">{t("appliesTo")}: {names.slice(0, 8).join(", ")}{names.length > 8 ? ` ${t("andMore", { count: names.length - 8 })}` : ""}</p>
              ) : (
                <p className="text-xs text-muted">{t("appliesToMatching", { count })}</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <button type="button" className={buttonClass("ghost", "md")} onClick={() => d.current?.close()}>{tc("cancel")}</button>
            {step === "choose" ? (
              <button type="button" className={buttonClass("primary", "md")} disabled={summary.length === 0} onClick={() => setStep("review")}>{t("review")}</button>
            ) : (
              <>
                <button type="button" className={buttonClass("secondary", "md")} onClick={() => setStep("choose")}>{tc("back")}</button>
                <button type="button" className={buttonClass("primary", "md")} disabled={pending} aria-busy={pending} onClick={submit}>
                  {pending ? tc("saving") : t("apply", { count })}
                </button>
              </>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}

function BulkDeleteDialog({ selection, count, onDone }: { selection: Selection; count: number; onDone: (message: string) => void }) {
  const t = useTranslations("admin.products.bulk");
  const tc = useTranslations("admin.common");
  const d = useRef<HTMLDialogElement>(null);
  const [plan, loadPlan, loading] = useActionState<BulkState, FormData>(previewBulkDeleteAction, null);
  const [result, run, running] = useActionState<BulkState, FormData>(bulkDeleteProductsAction, null);
  const [confirmText, setConfirmText] = useState("");
  const form = () => {
    const fd = new FormData();
    fd.set("selection", JSON.stringify(selection));
    return fd;
  };
  const open = () => {
    setConfirmText("");
    d.current?.showModal();
    startTransition(() => loadPlan(form()));
  };
  // The dialog stays open on its result list; the page notice repeats the summary.
  const summaryText = result?.ok ? t("deleteDone", { deleted: result.results?.filter((r) => r.outcome === "deleted").length ?? 0, archived: result.results?.filter((r) => r.outcome === "archived").length ?? 0 }) : null;
  const close = () => d.current?.close();
  const items = plan?.plan ?? [];
  const toDelete = items.filter((i) => i.action === "delete");
  const toArchive = items.filter((i) => i.action === "archive");

  return (
    <>
      <button type="button" className={buttonClass("danger", "sm")} onClick={open}>
        <TrashIcon size={14} /> {t("deleteSelected")}
      </button>
      <dialog ref={d} aria-labelledby="bulk-delete-title" className={dialogClass} onClose={() => { if (summaryText) onDone(summaryText); }}>
        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <h2 id="bulk-delete-title" className="font-display text-lg font-semibold">{t("deleteTitle", { count })}</h2>
            <p className="text-sm text-muted">{t("deleteHelp")}</p>
          </div>
          {result?.ok ? (
            <div className="space-y-2" data-testid="bulk-delete-result">
              <Alert tone="success">{t("deleteDone", { deleted: result.results?.filter((r) => r.outcome === "deleted").length ?? 0, archived: result.results?.filter((r) => r.outcome === "archived").length ?? 0 })}</Alert>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                {result.results?.map((r) => <li key={r.id}>{r.name}: {t(`outcome.${r.outcome}`)}</li>)}
              </ul>
            </div>
          ) : loading || !plan ? (
            <p role="status" className="text-sm text-muted">{tc("loading")}</p>
          ) : plan.error ? (
            <Alert tone="danger">{plan.error === "forbidden" || plan.error === "unauthorized" ? tc(plan.error) : t.has(`errors.${plan.error}`) ? t(`errors.${plan.error}`) : tc("error")}</Alert>
          ) : (
            <>
              <ul className="grid gap-2 sm:grid-cols-2">
                <li className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm"><strong className="ltr-nums">{toDelete.length}</strong> {t("willDelete")}</li>
                <li className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm"><strong className="ltr-nums">{toArchive.length}</strong> {t("willArchive")}</li>
              </ul>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("deleteTitle", { count })}</caption>
                  <thead className="bg-surface-2/70"><tr><th className="px-3 py-2 text-start">{tc("name")}</th><th className="px-3 py-2 text-start">{t("consequence")}</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td className="px-3 py-2">{i.name}</td>
                        <td className="px-3 py-2 text-xs">
                          {i.action === "delete" ? t("consequenceDelete", { files: i.files, previews: i.previews }) : i.action === "archive" ? t("consequenceArchive", { orders: i.orders, paid: i.paidOrders }) : t("consequenceKeep")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm">{t("deleteRules")}</p>
              {result?.error ? <Alert tone="danger">{t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : tc("error")}</Alert> : null}
              <label className="block text-sm font-medium">
                {t("typeDelete")}
                <input className={cn(controlClass, "mt-1")} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" dir="ltr" data-testid="bulk-delete-confirm" />
              </label>
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <button type="button" className={buttonClass("ghost", "md")} onClick={close}>{result?.ok ? tc("close") : tc("cancel")}</button>
            {!result?.ok && plan?.ok ? (
              <button
                type="button"
                className={buttonClass("danger", "md")}
                disabled={confirmText.trim() !== "DELETE" || running}
                aria-busy={running}
                onClick={() => {
                  const fd = form();
                  fd.set("confirmText", confirmText);
                  startTransition(() => run(fd));
                }}
              >
                {t("confirmDelete", { count: items.length })}
              </button>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
