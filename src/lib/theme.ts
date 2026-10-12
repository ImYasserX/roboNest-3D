// Theme preference shared by the server (reads the cookie to render
// <html data-theme>) and the toggle (writes it). Exactly two themes exist;
// dark is the RoboNest default. Not a secret, so the cookie is readable by
// client script.
export const THEME_COOKIE = "rn_theme";
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "dark";

/** Anything other than "light" (missing cookie, a legacy "system" value, garbage) means dark. */
export function parseTheme(value: string | undefined | null): Theme {
  return value === "light" ? "light" : DEFAULT_THEME;
}

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}
