# Security

This document describes the security design of RoboNest.3D, the checks performed, and the trade‑offs accepted. Report suspected vulnerabilities privately to the RoboNest owner, not in public issues.

## Assets and threats

| Asset | Main threats | Primary controls |
|---|---|---|
| Customer data (name, phone, address, order history) | IDOR, excessive data exposure, enumeration | Ownership checks in every query, customer views strip internal fields, rate‑limited lookups |
| Money (prices, discounts, delivery fees, totals) | Client‑side tampering, races, rounding | Server‑side repricing, integer IQD, CHECK constraints, atomic batches |
| Paid digital files | Unauthorized download, link sharing | Private bucket, per‑request authorization, per‑purchase download cap |
| Admin panel | Credential stuffing, privilege escalation, session theft | Separate identity store, lockout, TOTP, per‑action permission checks, strict cookies, audit log |
| Customer uploads | Malware hosting, XSS via uploaded HTML/SVG, storage abuse | Extension allowlist, magic‑byte sniffing, size limits, random keys, private bucket, attachment‑only serving |

## Authentication

### Customers

- Phone‑number accounts. Phones are normalized to E.164 (`+9647…`), and Arabic‑Indic digits are accepted.
- **Password hashing: PBKDF2‑HMAC‑SHA256, 100,000 iterations, 16‑byte random salt**, via WebCrypto. The stored format (`pbkdf2_sha256$<iterations>$<salt>$<hash>`) carries its parameters so hashes can be upgraded.
  - *Trade‑off:* OWASP currently recommends 600,000 PBKDF2 iterations or a memory‑hard function. Cloudflare Workers caps WebCrypto PBKDF2 at 100,000, and Argon2/scrypt in pure JS would exceed Worker CPU limits. Mitigations: minimum password length (8 customers / 12 admins), per‑IP **and** per‑phone login rate limits, admin lockout and TOTP. Revisit if Workers raises the cap (upgrade on next login).
- **Sessions:** 256‑bit random tokens; only SHA‑256(token) is stored, so a DB leak yields no usable cookies. Sessions are revocable, with 30‑day absolute expiry. A new token is issued on every sign‑in (**session fixation** defence). All sessions are revoked on password change or reset.
- **Cookies:** `__Host-rn_session` with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. The `__Host-` prefix blocks subdomain cookie injection. Plain names without the prefix are used in local development over HTTP. Tokens never touch `localStorage`.
- **Enumeration:** sign‑in returns one generic error for unknown phone, wrong password, or disabled account, and runs a dummy hash so timing does not reveal account existence. Registration necessarily reveals that a phone is taken; it is rate‑limited (5/hour per IP).
- **Password recovery:** there is no SMS provider, so recovery is staff‑assisted. After verifying the customer by phone or WhatsApp, staff generate a single‑use reset link valid for 1 hour (only its hash is stored, and older unused links are invalidated). Reset pages set a `no-referrer` referrer policy (`<meta name="referrer">`) so the token never leaks via `Referer`.
- **Phone ownership is not verified** (no OTP). This is a known limitation; see `FINAL_AUDIT.md`.

### Administrators

- Separate `admin_users` / `admin_sessions` tables and cookie (`__Host-rn_admin`, `SameSite=Strict`). Customer and admin sessions can never be confused.
- **Two roles with different authentication requirements:**
  - **Super Admin:** password **and TOTP are mandatory**. Until enrolled, every admin page and action redirects to enrollment.
  - **Operations:** password, with optional TOTP. The Super Admin can require TOTP for all admins (Settings → Security).
- TOTP (RFC 6238, SHA‑1, 6 digits, 30 s, ±1 step) is compatible with standard authenticator apps. Secrets are **AES‑256‑GCM encrypted** with a key derived (HKDF) from `APP_SECRET`. The last accepted time‑step is stored and codes at or before it are rejected (**replay protection**), with a compare‑and‑set so two concurrent requests cannot both succeed.
- Sign‑in is two‑step: the password creates an `MFA_PENDING` session (10‑minute TTL, 5 code attempts, then burned); a correct code creates a **new** `ACTIVE` session token.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes. While locked, only someone with the correct password learns about the lock (no username probing). Every failure and lock is audit‑logged.
- Active admin sessions: 12 h absolute, **2 h idle** timeout. Role or status changes and password resets revoke the target's sessions immediately.
- The last active Super Admin cannot be demoted or disabled.
- Production admins are created with `npm run admin:create` (password read without echo, only the hash written). The development seed must never run against production.

## Authorization

- Permission map: `src/lib/permissions.ts`. Operations **cannot**: manage admins, change security settings, view the audit log, view profit/cost data, manage discounts, or permanently delete products, categories, customers, or digital files.
- **Server‑side enforcement everywhere.** Pages call `requireAdminPage(locale, permission)`. Every admin server action goes through `withAdmin(permission, …)` (`src/server/admin-action.ts`). Admin route handlers call `requireAdminAction(permission)`. Hidden buttons are only a convenience. Verified by E2E (Operations is redirected from `/admin/admins`, `/audit-log`, `/settings`, `/discounts`) and by unit tests of the map.
- **Customer data (IDOR):**
  - Account order pages query `WHERE order_number = ? AND user_id = <session user>`.
  - Guest order pages require a 160‑bit HMAC‑derived token (only its hash is stored) that is compared in constant time.
  - "Track order" requires the order number **and** the checkout phone, rate‑limited to 10 per 15 min per IP, which makes brute force infeasible.
  - Cart lines can only be changed inside the caller's cart.
  - Uploads can only be attached by their owner.
  - Custom requests require the owner session or the link token.
  - All of this is covered by integration tests.
- **Data minimization:** customer order views omit admin notes, costs, token and idempotency hashes, and actor IDs. Admin queries select explicit columns (never password hashes or TOTP secrets).

## Business‑logic integrity

- The browser never supplies a price, discount, delivery fee, total, role, or ownership claim. `resolveLine` recomputes each line from database rows; unknown options, inactive values, out‑of‑range numbers, oversized text, control characters, negative/fractional/zero/> 100 quantities, and overflowing totals are rejected.
- Money is integer IQD with a bounded maximum (100,000,000). The database CHECKs `total = subtotal − discount + delivery` and `line_total = unit_price × quantity`.
- **Races:** stock and discount usage limits are enforced by CHECK constraints inside the checkout batch. Order status changes, quote acceptance, TOTP counters, and download counters use compare‑and‑set updates.
- **Duplicate orders:** each checkout render gets an idempotency key (unique index on the owner‑scoped hash). Double clicks, retries, and refresh‑resubmits return the same order; the submit button also disables while pending.
- Currency is fixed to `IQD` by the schema; the payment method is fixed to `COD`.

## Input validation and injection

- **SQL injection:** all queries go through Drizzle with bound parameters. Raw SQL fragments interpolate only constants or bound values. User search text is normalized, and its `LIKE` wildcards are escaped (`ESCAPE '\'`). Query‑string parameters are parsed through Zod whitelists before touching queries (tested with hostile inputs).
- **XSS:** React escapes all output. There is no `dangerouslySetInnerHTML` except (a) JSON‑LD, where `<` and U+2028/2029 are escaped, and (b) the admin TOTP QR code, an SVG generated server‑side from our own URI. Product descriptions are plain text rendered as paragraphs, never HTML. Admin URL settings accept only `https://`.
- **Command/template injection:** no shell execution or server‑side templating of user input.
- **Open redirects:** `?next=` goes through `safeRedirectPath` (same‑site relative paths only; rejects `//host`, `/\host`, schemes, and control characters). Unit‑tested.

## CSRF

- Server Actions check `Origin` against the host. Additionally, `src/middleware.ts` rejects **every** non‑GET/HEAD/OPTIONS request whose `Origin` (or `Referer`) is not same‑origin, including requests with neither header, which Server Actions alone would allow.
- Customer cookies are `SameSite=Lax`; the admin cookie is `SameSite=Strict`.
- Verified against the production Worker: a cross‑origin POST and an Origin‑less POST both return `403`.

## File uploads

| Purpose | Allowed | Max | Bucket |
|---|---|---|---|
| Product image | jpg, png, webp, avif (no SVG) | 8 MB | MEDIA |
| 3D preview | glb (glTF v2 magic) | 30 MB | MEDIA |
| Digital product | stl, 3mf, obj, glb, zip | 95 MB | PRIVATE_FILES |
| Custom print model | stl, 3mf, obj, zip | 50 MB | PRIVATE_FILES |
| Product option file | stl, 3mf, obj, zip, png, jpg, webp | 20 MB | PRIVATE_FILES |

- The request body is the raw file, streamed into R2 with `FixedLengthStream`, which enforces the declared length. `Content-Length` is checked before reading.
- The first 4 KB are **sniffed**: PNG/JPEG/WebP/AVIF/glTF/ZIP signatures; binary STL size must equal `84 + 50·n`; ASCII STL/OBJ must be valid UTF‑8 text with no NUL bytes and no markup. Renamed executables and HTML/SVG disguised as models are rejected (tested).
- Storage keys are `prefix/yyyy/mm/<uuid>.<ext>` and are never derived from the filename, so **no path traversal**. Filenames are sanitized for display only (basename, no control or bidi‑override characters).
- Files are never executed or parsed beyond the header bytes.
- Public media is only served for keys matching `(products|previews|categories)/yyyy/mm/<uuid>.<ext>`, with `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. Private files are only returned by authorized routes, as `application/octet-stream` attachments with the same sandbox CSP.
- **Storage abuse:** 20 uploads/hour per IP (per admin for staff), at most 30 unattached uploads per owner, and per‑purpose size caps.

## Rate limiting

Fixed‑window counters in D1 (`src/server/services/rate-limit.ts`). D1 is a single primary, so counters are global across isolates and locations, unlike in‑memory maps.

Iraqi mobile carriers use carrier‑grade NAT, where many customers can share one IP. Customer‑facing limits are therefore keyed on the **visitor cookie or account**, with a looser **per‑IP ceiling** as a backstop against cookie cycling. Credential‑guessing limits stay strict per target (phone, admin account).

| Bucket | Per visitor / account / target | Per IP backstop |
|---|---|---|
| Customer login | 5 / 15 min per phone | 40 / 15 min |
| Registration | — | 20 / h |
| Password reset / change | 10 / h per account | 10 / h (reset) |
| Admin login / TOTP | account lockout (5 wrong → 15 min) and 5 codes per MFA session | 10 / 15 min |
| Checkout | 10 / 10 min | 100 / 10 min (discount preview included) |
| Cart writes | 120 / 10 min | 1,000 / 10 min |
| Uploads | 20 / h (30 unattached max) | 150 / h |
| Custom requests | 5 / h | 40 / h |
| Quote accept/decline | — | 30 / h |
| Contact form | — | 20 / h (plus honeypot field) |
| Order lookup (number + phone) | — | 30 / 15 min |
| Downloads | 60 / h per user | — |

The client IP comes from `cf-connecting-ip`, which Cloudflare sets and clients cannot spoof. IPs are stored only as HMAC hashes. Recommended addition: a Cloudflare WAF rate‑limit rule on the admin login path.

## HTTP security headers

Set by `next.config.ts` (static) and `src/middleware.ts` (per request):

- `Content-Security-Policy`:
  - `default-src 'self'`
  - `script-src 'self' 'nonce-…' 'strict-dynamic' 'wasm-unsafe-eval'` (no `unsafe-inline` or `unsafe-eval` in production; `wasm-unsafe-eval` only allows `<model-viewer>`'s WebAssembly)
  - `style-src 'self' 'unsafe-inline'` (inline style attributes from `next/image` and model‑viewer)
  - `img-src 'self' data: blob:`, `connect-src 'self' blob:`
  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (production)
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` (order, custom‑request, and reset pages add a `no-referrer` meta policy), `Permissions-Policy` (camera, microphone, geolocation, payment, usb, topics disabled), `Cross-Origin-Opener-Policy: same-origin`.
- Admin responses: `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`.

## Secrets

- Only `APP_SECRET` is a secret, supplied via `wrangler secret put` (production) or `.dev.vars` (local, git‑ignored, generated randomly by `npm run setup`). The app fails closed if it is missing or shorter than 32 characters.
- D1/R2 are accessed through bindings, so no database URLs or storage keys exist in code or configuration.
- The only `NEXT_PUBLIC_` variable is `NEXT_PUBLIC_IMAGE_TRANSFORMS` (a non‑secret feature flag).
- Verified: client bundles contain no server modules or secret names; no source maps are published; the repository contains no credentials. The E2E fixture passwords are throwaway values for the local test database only.

## Error handling and logging

- Error boundaries show a generic message and the opaque `digest` only, never stack traces, SQL, paths, or environment details. Services return typed error codes that the UI translates.
- Server logs record short, sanitized reasons (e.g. a failed batch) without request bodies, passwords, or tokens.
- **Audit log** (`audit_logs`): admin login, logout, failures and lockouts; product create/update/archive/delete, price, status, inventory, options, images, preview and digital files; order status, payment and notes; custom‑request reviews; customer edits, deletions and reset‑link creation; delivery zone and area changes; discounts; settings; admin create/update/password reset/TOTP reset. Metadata keys that look like credentials (`pass`, `secret`, `token`, `totp`, `otp`, `hash`, `cookie`) are stripped automatically (tested). Audit entries record actor, action, target, metadata, time, and a hashed IP.

## Dependencies

- `npm audit --omit=dev`: **0 vulnerabilities**.
- `npm audit` (including dev): 4 moderate advisories, all in `esbuild@0.18` pulled in by `drizzle-kit` (the local migration generator). They affect esbuild's dev server, which this project never runs and which is not part of the deployed Worker.

## Known security limitations

See **Known issues** in `FINAL_AUDIT.md`. In short:
- PBKDF2 at 100k iterations (platform cap).
- Phone ownership not verified by OTP.
- Recovery is staff‑assisted.
- No automated malware scanning of uploaded archives (files are never executed or served inline).
- Per‑IP backstops can still throttle very large groups behind one carrier NAT; tune the numbers in `rate-limit.ts` from real traffic.
