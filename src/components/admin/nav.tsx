"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/components/ui/cn";

export type AdminNavItem = { href: string; key: string };

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const list = (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex min-h-10 items-center rounded-md px-3 text-sm font-medium", active ? "bg-primary text-on-primary" : "text-text hover:bg-surface-2")}
            >
              {t(item.key)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <nav aria-label={t("label")}>
      <details className="lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-border px-3 font-semibold">☰ {t("openMenu")}</summary>
        <div className="mt-2">{list}</div>
      </details>
      <div className="hidden lg:block">{list}</div>
    </nav>
  );
}
