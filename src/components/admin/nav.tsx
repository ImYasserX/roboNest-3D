"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/components/ui/cn";
import {
  ArchiveIcon, BellIcon, ChartIcon, CubeIcon, FileIcon, GridIcon, LayersIcon, ListIcon, MenuIcon, MessageIcon,
  PencilIcon, PrinterIcon, ReceiptIcon, SettingsIcon, ShieldIcon, TagIcon, TruckIcon, UsersIcon, WalletIcon,
} from "@/components/ui/icons";

export type AdminNavItem = { href: string; key: string; icon: string };
export type AdminNavGroup = { key: string; items: AdminNavItem[] };

const ICONS: Record<string, (p: { size?: number; className?: string }) => React.ReactNode> = {
  grid: GridIcon, receipt: ReceiptIcon, wallet: WalletIcon, printer: PrinterIcon, tag: TagIcon, cube: CubeIcon, file: FileIcon,
  layers: LayersIcon, list: ListIcon, users: UsersIcon, message: MessageIcon, truck: TruckIcon, bell: BellIcon, chart: ChartIcon,
  pencil: PencilIcon, settings: SettingsIcon, shield: ShieldIcon, archive: ArchiveIcon,
};

/** Sidebar on large screens; a collapsible menu (no JavaScript needed) on phones and tablets. */
export function AdminNav({ groups, footer }: { groups: AdminNavGroup[]; footer?: React.ReactNode }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const list = (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.key}>
          {group.key !== "overview" ? <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted">{t(`groups.${group.key}`)}</p> : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = ICONS[item.icon] ?? GridIcon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                      active ? "bg-primary-soft text-text shadow-[inset_3px_0_0_var(--rn-primary)] rtl:shadow-[inset_-3px_0_0_var(--rn-primary)]" : "text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <Icon size={18} className={active ? "text-primary-text" : "text-muted group-hover:text-text"} />
                    {t(item.key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
  return (
    <nav aria-label={t("label")} className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <details className="group px-4 pb-4 lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-border px-3 font-semibold">
          <MenuIcon size={18} /> {t("openMenu")}
        </summary>
        <div className="mt-3 space-y-4">
          {list}
          {footer}
        </div>
      </details>
      <div className="hidden min-h-0 flex-1 flex-col lg:flex">
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">{list}</div>
        <div className="px-3 pb-4">{footer}</div>
      </div>
    </nav>
  );
}
