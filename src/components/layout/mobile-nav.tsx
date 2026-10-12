"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { CloseIcon, MenuIcon } from "@/components/ui/icons";
import type { Theme } from "@/lib/theme";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeChooser } from "./theme-toggle";

type NavItem = { href: string; label: string };

/**
 * Mobile menu built on the native <dialog> element: showModal() gives focus
 * trapping, Escape to close, and an inert background without custom code.
 *
 * The hamburger sits at the inline START of the header, so the panel is
 * anchored to the inline start too (`me-auto`, border on the end edge): left
 * in English (LTR), right in Arabic (RTL). The slide-in animation direction
 * follows the same edge.
 */
export function MobileNav({ items, secondary, theme }: { items: NavItem[]; secondary: NavItem[]; theme: Theme }) {
  const t = useTranslations("nav");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-surface-2 sm:size-11 lg:hidden"
        aria-label={t("openMenu")}
        aria-haspopup="dialog"
        aria-controls="mobile-menu"
        data-testid="menu-button"
        onClick={() => dialogRef.current?.showModal()}
      >
        <MenuIcon />
      </button>
      <dialog
        ref={dialogRef}
        id="mobile-menu"
        aria-label={t("mainNav")}
        data-testid="mobile-menu"
        className="mobile-drawer fixed inset-y-0 start-0 m-0 me-auto h-dvh max-h-dvh w-[min(22rem,88vw)] max-w-none overflow-hidden border-e border-border bg-surface p-0 text-text shadow-card backdrop:bg-overlay"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        onClose={() => buttonRef.current?.focus()}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border p-4">
            <span className="font-display text-lg font-bold" dir="ltr">RoboNest.3D</span>
            <button
              type="button"
              autoFocus
              className="inline-flex size-11 items-center justify-center rounded-md hover:bg-surface-2"
              aria-label={t("closeMenu")}
              onClick={() => dialogRef.current?.close()}
            >
              <CloseIcon />
            </button>
          </div>
          <nav aria-label={t("mainNav")} className="flex-1 overflow-y-auto overscroll-contain p-2">
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined} className="flex min-h-12 items-center rounded-md px-3 text-base font-medium hover:bg-surface-2 aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary-text">
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
          <div className="space-y-3 border-t border-border p-4">
            <ThemeChooser initial={theme} />
            <LanguageSwitcher className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 hover:bg-surface-2" />
          </div>
        </div>
      </dialog>
    </>
  );
}
