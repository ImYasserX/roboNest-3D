import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ChevronIcon } from "./icons";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const t = useTranslations("common");
  return (
    <nav aria-label={t("breadcrumb")} className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? <ChevronIcon size={14} className="rtl:rotate-180" /> : null}
            {item.href && i < items.length - 1 ? (
              <Link href={item.href} className="hover:text-text hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined} className="text-text">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
