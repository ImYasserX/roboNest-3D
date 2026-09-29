/**
 * Only allows same-site relative paths ("/en/account"). Rejects absolute URLs,
 * protocol-relative "//evil.com", backslash tricks and control characters, so
 * a ?next= parameter can never become an open redirect.
 */
export function safeRedirectPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://robonest.invalid");
    if (url.origin !== "https://robonest.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
