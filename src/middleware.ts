import { NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Edge middleware (Next 16 calls this convention "proxy"; the Node-runtime
// proxy.ts is only experimentally supported by OpenNext on Cloudflare, so the
// officially supported Edge middleware is used; see ARCHITECTURE.md).
// Runs before every matched request:
//  1. CSRF defence-in-depth: state-changing requests must come from our own
//     origin (Server Actions also check Origin, but accept a missing header).
//  2. Content-Security-Policy with a per-request nonce for Next's scripts.
//  3. Cheap admin gate (cookie presence). Real authorization happens on the
//     server in requireAdminPage/requireAdminAction; this only avoids
//     rendering admin shells for anonymous visitors.
//  4. Locale negotiation and /ar | /en prefixes (next-intl).

const intl = createIntlMiddleware(routing);
const isDev = process.env.NODE_ENV !== "production";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ADMIN_COOKIES = ["__Host-rn_admin", "rn_admin"];

function expectedOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const expected = expectedOrigin(request);
  if (origin) return origin === expected;
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // No WebAssembly is needed since the GLB viewer was removed.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by next/image.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' blob:${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // No exemptions: there are no payment-provider callbacks any more (manual
  // WhatsApp payment verification), so every state-changing request must be
  // same-origin.
  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // API and media routes: no locale handling, no HTML.
  if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) {
    return NextResponse.next();
  }

  const adminMatch = /^\/(ar|en)\/admin(\/|$)/.exec(pathname);
  if (adminMatch && !/^\/(ar|en)\/admin\/login(\/|$)/.test(pathname)) {
    const hasCookie = ADMIN_COOKIES.some((name) => request.cookies.has(name));
    if (!hasCookie) {
      return NextResponse.redirect(new URL(`/${adminMatch[1]}/admin/login`, request.url));
    }
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const response = intl(new NextRequest(request, { headers }));
  response.headers.set("Content-Security-Policy", csp);
  if (adminMatch) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

export const config = {
  // Everything except Next internals and static files in /public.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icon.svg|manifest.webmanifest|robots.txt|sitemap.xml|brand/).*)"],
};
