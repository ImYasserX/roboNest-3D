"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/components/ui/cn";

export function AccountNav() {
  const t = useTranslations("account");
  const pathname = usePathname();
  const items = [
    { href: "/account", label: t("overview") },
    { href: "/account/orders", label: t("orders") },
    { href: "/account/downloads", label: t("downloads") },
    { href: "/account/custom-requests", label: t("customRequests") },
    { href: "/wishlist", label: t("wishlist") },
    { href: "/account/security", label: t("security") },
  ];
  return (
    <nav aria-label={t("sections")}>
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col">
        {items.map((item) => {
          const active = item.href === "/account" ? pathname === "/account" : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex min-h-11 items-center rounded-md px-3 text-sm font-medium", active ? "bg-primary-soft text-primary-text" : "text-muted hover:bg-surface-2 hover:text-text")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
