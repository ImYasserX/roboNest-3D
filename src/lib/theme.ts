// Theme preference shared by the server (reads the cookie to render
// <html data-theme>) and the toggle (writes it). Not a secret, so the cookie
// is readable by client script.
export const THEME_COOKIE = "rn_theme";
export const THEMES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEMES)[number];

export function parseTheme(value: string | undefined | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** The data-theme attribute for a preference; undefined lets CSS follow the OS. */
export function themeAttribute(pref: ThemePreference): "light" | "dark" | undefined {
  return pref === "system" ? undefined : pref;
}

export function nextTheme(pref: ThemePreference): ThemePreference {
  return THEMES[(THEMES.indexOf(pref) + 1) % THEMES.length];
}
