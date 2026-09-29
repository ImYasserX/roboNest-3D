import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "./button";
import { ChevronIcon } from "./icons";

/** Link-based pagination: works without JavaScript and is crawlable. */
export function Pagination({ page, pageCount, pathname, searchParams }: { page: number; pageCount: number; pathname: string; searchParams: Record<string, string | undefined> }) {
  const t = useTranslations("common");
  if (pageCount <= 1) return null;
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "page") params.set(k, v);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  return (
    <nav aria-label={t("pagination")} className="mt-10 flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonClass("secondary", "md")} rel="prev">
          <ChevronIcon className="rotate-180 rtl:rotate-0" />
          {t("previous")}
        </Link>
      ) : null}
      <span className="text-sm text-muted" aria-current="page">
        {t("pageOf", { page, total: pageCount })}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={buttonClass("secondary", "md")} rel="next">
          {t("next")}
          <ChevronIcon className="rtl:rotate-180" />
        </Link>
      ) : null}
    </nav>
  );
}
