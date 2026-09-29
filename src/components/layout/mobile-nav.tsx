"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { CloseIcon, MenuIcon } from "@/components/ui/icons";
import { LanguageSwitcher } from "./language-switcher";

type NavItem = { href: string; label: string };

/**
 * Mobile menu built on the native <dialog> element: showModal() gives focus
 * trapping, Escape to close, and an inert background without custom code.
 */
export function MobileNav({ items, secondary }: { items: NavItem[]; secondary: NavItem[] }) {
  const t = useTranslations("nav");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        className="inline-flex size-10 items-center justify-center rounded-md hover:bg-surface-2 sm:size-11 lg:hidden"
        aria-label={t("openMenu")}
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        <MenuIcon />
      </button>
      <dialog
        ref={dialogRef}
        aria-label={t("mainNav")}
        className="m-0 ms-auto h-dvh max-h-dvh w-[min(22rem,100vw)] max-w-none border-s border-border bg-surface p-0 text-text backdrop:bg-overlay"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border p-4">
            <span className="font-display text-lg font-bold">RoboNest.3D</span>
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-md hover:bg-surface-2"
              aria-label={t("closeMenu")}
              onClick={() => dialogRef.current?.close()}
            >
              <CloseIcon />
            </button>
          </div>
          <nav aria-label={t("mainNav")} className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex min-h-12 items-center rounded-md px-3 text-base font-medium hover:bg-surface-2">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <hr className="my-3 border-border" />
            <ul className="space-y-1">
              {secondary.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex min-h-11 items-center rounded-md px-3 text-sm text-muted hover:bg-surface-2 hover:text-text">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="border-t border-border p-4">
            <LanguageSwitcher className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 hover:bg-surface-2" />
          </div>
        </div>
      </dialog>
    </>
  );
}
