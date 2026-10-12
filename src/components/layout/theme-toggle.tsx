"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { THEME_COOKIE, THEMES, nextTheme, type Theme } from "@/lib/theme";
import { cn } from "@/components/ui/cn";

// One module-level store, so every toggle on the page (header, mobile menu)
// shows the same theme without duplicated React state.
let current: Theme | null = null;
const listeners = new Set<() => void>();

function apply(theme: Theme) {
  current = theme;
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f7f6fb" : "#0c0a14");
  listeners.forEach((l) => l());
}

function useTheme(initial: Theme) {
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

function ThemeGlyph({ theme }: { theme: Theme }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  return theme === "light" ? (
    <svg {...common}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ) : (
    <svg {...common}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

/** Compact header button: switches between dark and light. */
export function ThemeToggle({ initial, className }: { initial: Theme; className?: string }) {
  const t = useTranslations("theme");
  const theme = useTheme(initial);
  const label = t("toggleLabel", { current: t(theme), next: t(nextTheme(theme)) });
  return (
    <button type="button" onClick={() => apply(nextTheme(theme))} className={className} aria-label={label} title={label}>
      <ThemeGlyph theme={theme} />
    </button>
  );
}

/** Two-option radio group for the mobile menu. */
export function ThemeChooser({ initial }: { initial: Theme }) {
  const t = useTranslations("theme");
  const theme = useTheme(initial);
  return (
    <fieldset className="space-y-2">
      <legend className="px-1 text-sm font-medium text-muted">{t("label")}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {THEMES.map((option) => (
          <label
            key={option}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
              theme === option ? "bg-primary text-on-primary" : "hover:bg-surface-3",
            )}
          >
            <input type="radio" name="theme-choice" value={option} checked={theme === option} onChange={() => apply(option)} className="sr-only" />
            <ThemeGlyph theme={option} />
            <span>{t(option)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
