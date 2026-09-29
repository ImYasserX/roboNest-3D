import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { controlClass } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";

export function AdminPageHeader({ title, children, description }: { title: string; children?: React.ReactNode; description?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

/** GET filter bar: search + selects. Works without JavaScript. */
export async function FilterBar({
  action,
  q,
  placeholder,
  selects = [],
}: {
  action: string;
  q?: string;
  placeholder?: string;
  selects?: { name: string; label: string; value?: string; options: [string, string][] }[];
}) {
  const t = await getTranslations("admin.common");
  return (
    <form action={action} method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2">
      {placeholder !== undefined ? (
        <div className="min-w-48 flex-1">
          <label htmlFor="f-q" className="mb-1 block text-xs font-medium text-muted">{t("search")}</label>
          <input id="f-q" name="q" type="search" defaultValue={q} placeholder={placeholder} maxLength={80} className={controlClass} />
        </div>
      ) : null}
      {selects.map((s) => (
        <div key={s.name}>
          <label htmlFor={`f-${s.name}`} className="mb-1 block text-xs font-medium text-muted">{s.label}</label>
          <select id={`f-${s.name}`} name={s.name} defaultValue={s.value ?? ""} className={controlClass}>
            <option value="">{t("all")}</option>
            {s.options.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      ))}
      <button type="submit" className={buttonClass("secondary", "md")}>{t("filter")}</button>
    </form>
  );
}

export async function AdminPagination({ page, pageCount, path, params }: { page: number; pageCount: number; path: string; params: Record<string, string | undefined> }) {
  if (pageCount <= 1) return null;
  const t = await getTranslations("admin.common");
  const tc = await getTranslations("common");
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    sp.set("page", String(p));
    return `${path}?${sp}`;
  };
  return (
    <nav aria-label={tc("pagination")} className="mt-4 flex items-center justify-between gap-3 text-sm">
      {page > 1 ? <Link href={href(page - 1)} className={buttonClass("secondary", "sm")}>{tc("previous")}</Link> : <span />}
      <span className="text-muted">{t("page", { page, total: pageCount })}</span>
      {page < pageCount ? <Link href={href(page + 1)} className={buttonClass("secondary", "sm")}>{tc("next")}</Link> : <span />}
    </nav>
  );
}

export function Panel({ title, children, className, id }: { title?: string; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section aria-labelledby={title ? id ?? undefined : undefined} className={`rounded-xl border border-border bg-surface p-4 sm:p-5 ${className ?? ""}`}>
      {title ? <h2 id={id} className="mb-4 font-display text-lg font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}
