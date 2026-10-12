import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { controlClass } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { ChevronIcon, SearchIcon } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";

// Shared admin building blocks. Every admin page is composed from these, so
// spacing, typography, filters, tabs and pagination look and behave the same
// everywhere (see components/admin/README in ARCHITECTURE.md, "Admin UI").

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items, label }: { items: Crumb[]; label: string }) {
  return (
    <nav aria-label={label} className="mb-2 text-xs text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1">
            {i > 0 ? <ChevronIcon size={12} className="rtl:rotate-180 opacity-60" /> : null}
            {c.href && i < items.length - 1 ? (
              <Link href={c.href} className="rounded hover:text-text hover:underline">{c.label}</Link>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined} className={i === items.length - 1 ? "text-text" : undefined}>{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export async function AdminPageHeader({
  title,
  children,
  description,
  breadcrumbs,
}: {
  title: string;
  children?: React.ReactNode;
  description?: string;
  breadcrumbs?: Crumb[];
}) {
  const t = await getTranslations("admin.common");
  return (
    <header className="mb-6 border-b border-border pb-5">
      {breadcrumbs && breadcrumbs.length > 1 ? <Breadcrumbs items={breadcrumbs} label={t("breadcrumbs")} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-[1.75rem]">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
        </div>
        {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
      </div>
    </header>
  );
}

/** Link-based tabs (work without JavaScript; the URL is the state). */
export function AdminTabs({ tabs, current, label }: { tabs: { value: string; label: string; href: string; count?: number }[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border px-1">
        {tabs.map((tab) => {
          const active = tab.value === current;
          return (
            <li key={tab.value}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors",
                  active ? "border-primary text-text" : "border-transparent text-muted hover:border-border-strong hover:text-text",
                )}
              >
                {tab.label}
                {tab.count !== undefined ? (
                  <span className={cn("ltr-nums rounded-full px-2 py-0.5 text-xs", active ? "bg-primary text-on-primary" : tab.count > 0 ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted")}>{tab.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** GET filter bar: search + selects. Works without JavaScript; filters live in the URL. */
export async function FilterBar({
  action,
  q,
  placeholder,
  selects = [],
  hidden = {},
}: {
  action: string;
  q?: string;
  placeholder?: string;
  selects?: { name: string; label: string; value?: string; options: [string, string][]; includeAll?: boolean }[];
  hidden?: Record<string, string | undefined>;
}) {
  const t = await getTranslations("admin.common");
  const active = Boolean(q) || selects.some((s) => s.value && s.name !== "sort");
  return (
    <form action={action} method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {placeholder !== undefined ? (
        <div className="min-w-52 flex-1">
          <label htmlFor="f-q" className="mb-1 block text-xs font-medium text-muted">{t("search")}</label>
          <div className="relative">
            <SearchIcon size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
            <input id="f-q" name="q" type="search" defaultValue={q} placeholder={placeholder} maxLength={80} className={cn(controlClass, "ps-9")} />
          </div>
        </div>
      ) : null}
      {selects.map((s) => (
        <div key={s.name} className="min-w-36">
          <label htmlFor={`f-${s.name}`} className="mb-1 block text-xs font-medium text-muted">{s.label}</label>
          <select id={`f-${s.name}`} name={s.name} defaultValue={s.value ?? ""} className={controlClass}>
            {s.includeAll === false ? null : <option value="">{t("all")}</option>}
            {s.options.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      ))}
      <button type="submit" className={buttonClass("secondary", "md")}>{t("filter")}</button>
      {active ? (
        <a href={`${action}${Object.values(hidden).some(Boolean) ? `?${new URLSearchParams(Object.entries(hidden).filter((e): e is [string, string] => Boolean(e[1])))}` : ""}`} className={buttonClass("ghost", "md")}>
          {t("clearFilters")}
        </a>
      ) : null}
    </form>
  );
}

export async function AdminPagination({ page, pageCount, path, params, total, pageSize }: { page: number; pageCount: number; path: string; params: Record<string, string | undefined>; total?: number; pageSize?: number }) {
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
    <nav aria-label={tc("pagination")} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      {page > 1 ? <Link href={href(page - 1)} className={buttonClass("secondary", "sm")}>{tc("previous")}</Link> : <span />}
      <span className="ltr-nums text-muted">
        {total !== undefined && pageSize ? t("showing", { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total }) : t("page", { page, total: pageCount })}
      </span>
      {page < pageCount ? <Link href={href(page + 1)} className={buttonClass("secondary", "sm")}>{tc("next")}</Link> : <span />}
    </nav>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section aria-labelledby={title ? id ?? undefined : undefined} className={cn("rounded-xl border border-border bg-surface p-4 shadow-[var(--rn-shadow)] sm:p-5", className)}>
      {title ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id={id} className="font-display text-base font-semibold sm:text-lg">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function AdminEmpty({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong/50 bg-surface/50 px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {text ? <p className="mx-auto mt-1 max-w-md text-sm text-muted">{text}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Loading placeholder shaped like a page header, filter bar and table. */
export function AdminSkeleton() {
  const bar = "animate-pulse rounded-md bg-surface-2";
  return (
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-2 border-b border-border pb-5">
        <div className={cn(bar, "h-3 w-40")} />
        <div className={cn(bar, "h-8 w-72")} />
      </div>
      <div className={cn(bar, "h-16 w-full")} />
      <div className="space-y-2 rounded-xl border border-border p-3">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className={cn(bar, "h-9 w-full")} />)}
      </div>
    </div>
  );
}
