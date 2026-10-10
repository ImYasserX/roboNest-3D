"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { THEME_COOKIE, THEMES, nextTheme, themeAttribute, type ThemePreference } from "@/lib/theme";
import { cn } from "@/components/ui/cn";

// One module-level store, so every toggle on the page (header, mobile menu)
// shows the same preference without duplicated React state.
let current: ThemePreference | null = null;
const listeners = new Set<() => void>();

function apply(pref: ThemePreference) {
  current = pref;
  const attr = themeAttribute(pref);
  if (attr) document.documentElement.dataset.theme = attr;
  else delete document.documentElement.dataset.theme;
  document.cookie = `${THEME_COOKIE}=${pref}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  listeners.forEach((l) => l());
}

function useTheme(initial: ThemePreference) {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current ?? initial,
    // The server rendered `initial` from the same cookie, so hydration matches.
    () => initial,
  );
}

function ThemeGlyph({ pref }: { pref: ThemePreference }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (pref === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (pref === "dark")
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

/** Compact header button: cycles system → light → dark. */
export function ThemeToggle({ initial, className }: { initial: ThemePreference; className?: string }) {
  const t = useTranslations("theme");
  const pref = useTheme(initial);
  return (
    <button
      type="button"
      onClick={() => apply(nextTheme(pref))}
      className={className}
      aria-label={t("toggleLabel", { current: t(pref), next: t(nextTheme(pref)) })}
      title={t("toggleLabel", { current: t(pref), next: t(nextTheme(pref)) })}
    >
      <ThemeGlyph pref={pref} />
    </button>
  );
}

/** Full radio group for the mobile menu, where there is room for labels. */
export function ThemeChooser({ initial }: { initial: ThemePreference }) {
  const t = useTranslations("theme");
  const pref = useTheme(initial);
  return (
    <fieldset className="space-y-2">
      <legend className="px-1 text-sm font-medium text-muted">{t("label")}</legend>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {THEMES.map((option) => (
          <label
            key={option}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
              pref === option ? "bg-primary text-on-primary" : "hover:bg-surface-3",
            )}
          >
            <input type="radio" name="theme-choice" value={option} checked={pref === option} onChange={() => apply(option)} className="sr-only" />
            <ThemeGlyph pref={option} />
            <span>{t(option)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
