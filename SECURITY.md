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
- **Phone verification (SMS, `src/server/services/phone-verification.ts`):** an account is only created after the SMS provider (Twilio Verify) approves the code sent to the number. The registration form only creates a *challenge*: the pending name and password hash are stored on the challenge row, so a second registration for the same number can never overwrite the first person's password. Challenges are bound to a random token in an HttpOnly cookie (only its SHA‑256 is stored), expire after 10 minutes, allow 5 code attempts and 3 sends with a 60 s resend cooldown, and are rate‑limited per number and per IP. Codes are generated and checked by Twilio; this app never stores or logs them. The optional WhatsApp channel generates codes itself and stores only an HMAC bound to the phone number ([docs/WHATSAPP_OTP.md](docs/WHATSAPP_OTP.md)). Sessions are only issued, and only honoured, for users with `phone_verified_at` set. Without Twilio credentials the flow is **inactive**: registration is disabled and nothing treats an unverified number as verified.
- **Enumeration:** sign‑in returns one generic error for unknown phone, wrong password, or disabled account, and runs a dummy hash so timing does not reveal account existence. Registration answers identically for new and existing numbers; if the number already has a verified account, only the person who receives the SMS learns it, and nothing is changed. "Verify your phone" is only shown after a correct password.
- **Password recovery:** with Twilio configured, recovery is self‑service: enter the phone, prove control with the SMS code, then set a new password within 10 minutes; all sessions are revoked. Unknown numbers get the same screens but no SMS is sent and no code is accepted. Without Twilio, recovery stays staff‑assisted: staff verify the customer and generate a single‑use reset link valid for 1 hour (only its hash is stored). Reset pages set a `no-referrer` referrer policy so the token never leaks via `Referer`.

### Administrators

- Separate `admin_users` / `admin_sessions` tables and cookie (`__Host-rn_admin`, `SameSite=Strict`). Customer and admin sessions can never be confused.
- **Three roles:**
  - **Owner** (two accounts: Yasser and Ayman): every permission; password **and TOTP are mandatory**. Provisioned only by `scripts/bootstrap-owners.ts`, never from the admin UI or any route. Triggers in migration 0001 cap owners at two and reject deleting, demoting, promoting into, or disabling an owner. Only another owner can reset an owner's password or TOTP.
  - **Super Admin:** password **and TOTP are mandatory**. Every permission **except `payments.verify`**: confirming that money was received is Owner-only (the owners left Super Admin verification open, so it stays off; `SUPER_ADMIN_MAY_VERIFY_PAYMENTS` in `src/lib/permissions.ts`). Until enrolled, every admin page and action redirects to enrollment.
  - **Operations:** password, with optional TOTP. The Super Admin can require TOTP for all admins (Settings → Security).
- TOTP (RFC 6238, SHA‑1, 6 digits, 30 s, ±1 step) is compatible with standard authenticator apps. Secrets are **AES‑256‑GCM encrypted** with a key derived (HKDF) from `APP_SECRET`. The last accepted time‑step is stored and codes at or before it are rejected (**replay protection**), with a compare‑and‑set so two concurrent requests cannot both succeed.
- Sign‑in is two‑step: the password creates an `MFA_PENDING` session (10‑minute TTL, 5 code attempts, then burned); a correct code creates a **new** `ACTIVE` session token.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes. While locked, only someone with the correct password learns about the lock (no username probing). Every failure and lock is audit‑logged.
- Active admin sessions: 12 h absolute, **2 h idle** timeout. Role or status changes and password resets revoke the target's sessions immediately.
- The last active Owner/Super Admin cannot be demoted or disabled.
- Production admins are created with `npm run admin:create` (password read without echo, only the hash written). The development seed must never run against production.

## Authorization

- Permission map: `src/lib/permissions.ts`. Operations **cannot**: manage admins, change security settings, view the audit log, view profit/cost data, manage discounts, or permanently delete products, categories, customers, or digital files.
- **Server‑side enforcement everywhere.** Pages call `requireAdminPage(locale, permission)`. Every admin server action goes through `withAdmin(permission, …)` (`src/server/admin-action.ts`). Admin route handlers call `requireAdminAction(permission)`. Hidden buttons are only a convenience. Verified by E2E (Operations is redirected from `/admin/admins`, `/audit-log`, `/settings`, `/discounts`) and by unit tests of the map.
- **Customer data (IDOR):**
  - Account order pages query `WHERE order_number = ? AND user_id = <session user>`.
  - Guest order pages require a 160‑bit HMAC‑derived token (only its hash is stored) that is compared in constant time.
  - There is no public order lookup (the former "track an order" page was removed).
  - Deposit submissions require the order link token or account ownership.
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
- Currency is fixed to `IQD` by the schema.
- **Delivery fee** is the flat `FLAT_DELIVERY_FEE_IQD` (5,000) computed on the server; legacy per-zone fee columns are ignored.
- **Payments and deposits (manual WhatsApp verification, docs/PAYMENTS.md):** orders whose goods total after discount (excluding delivery) is strictly above 50,000 IQD start in `AWAITING_DEPOSIT` with a deposit of exactly 30% (rounded down), enforced by triggers. Nothing a customer does (opening WhatsApp, a message, a reference, a screenshot, a redirect) changes a payment; there is no payment-provider callback (the FIB route answers 410 and the middleware has no same-origin exemption). Only an **Owner** (`payments.verify`) confirms, disputes or records a refund, re-typing the exact amount due; the server takes amounts and state from the order row. Migration 0005 triggers refuse PAID / VERIFIED without a CONFIRMED `payment_verifications` row, wrong amounts, confirmations for orders that are not waiting for that payment, double confirmations (unique index) and any edit of the ledger. A verified deposit never marks the order paid or unlocks downloads. The generic status change cannot leave the deposit stages, `orders_deposit_gate` blocks fulfilment until the deposit is verified, and DELIVERED never marks an order paid. Every decision is audit‑logged.
- **Notifications:** the Telegram outbox row is written in the order batch; delivery is claimed with compare‑and‑set and retried per recipient, so retries never duplicate orders or messages. Admins can only send a fixed test text. The bot token is redacted from stored errors and logs.
- **Contact form:** server-side Zod validation and length limits, header-injection-safe subject, max 3 links, a honeypot, an HMAC-signed render timestamp (submissions under 3 s are refused), and per-IP and per-email rate limits. Visitors see success only when Resend accepted the email.

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

## 3D model protection

**Goal:** paid and original models never reach a browser unless the visitor bought them. The storefront's interactive 3D viewer shows a separate, deliberately reduced **preview proxy** instead.

- **Two kinds of asset, two places.** Originals (paid files) are rows in `digital_files` and objects in the private `PRIVATE_FILES` bucket. Preview proxies are rows in `preview_models` (migration 0004) and objects in `MEDIA` under `preview-proxies/YYYY/MM/<uuid>.glb`. No code path copies an original into `MEDIA`, and the public preview route never reads `PRIVATE_FILES`.
- **What a proxy is** (`src/server/preview/proxy.ts`): vertex clustering on a coarse grid (at most 96 cells per axis), at most **half** of the original's triangles and at most 20,000, small separate parts dropped (under 1 % of triangles), centred and **scaled to unit size** (real millimetre dimensions are not delivered), no normals, textures, names or metadata. Fine detail such as text, threads, small holes and pins collapses.
- **Proxy vs original is decided by content, not by name.** `inspectProxyGlb` parses the actual bytes: it must be a GLB 2.0 with one buffer inside the file, one mesh, triangles, POSITION (and optionally NORMAL) only, no images, textures, animations, skins or extensions, at most 20,000 triangles and 3 MB, coordinates on a grid (at most 97 distinct values per axis) and unit size. A raw export of an original fails on several of these at once. In addition the proxy's SHA-256 must differ from every paid file's fingerprint (`digital_files.sha256`, computed at upload or lazily), and its triangle count must be at most 50 % of the original's when that is known. Database triggers refuse a `preview_models` row whose hash equals a paid file's hash, and the reverse.
- **Nothing is published automatically.** Generating (admin → product → 3D preview, server side from an STL/OBJ/GLB up to 25 MB) or uploading (a proxy GLB made with `npm run preview:proxy`) creates a `PENDING_REVIEW` row. A person with the new `previews.approve` permission (Owner, Super Admin; not Operations) reviews it in the admin viewer (`/api/admin/previews/[id]`, admin session required) and approves it. Approval re-reads the stored object and re-runs every check; one approved proxy per product (partial unique index), approving a new one retires the old one. Reject, withdraw and delete are audited (`preview.*` actions).
- **Public route:** `/api/previews/[id]` serves a proxy only when the id is a UUID of an `APPROVED` row whose product is `PUBLISHED`, the key matches the proxy layout, and the stored bytes still hash to the approved value and still pass the validator (a swapped object is refused). Ids of paid files, product ids, storage keys and traversal strings return 404. Headers: `Content-Type: model/gltf-binary`, `Cache-Control: private, no-cache` with `ETag` = the hash (browsers revalidate each time, so a withdrawn preview stops at once; shared caches do not store it), `nosniff`, `sandbox` CSP, `Cross-Origin-Resource-Policy: same-origin`. 404s are `no-store`. There is no fallback: if no approved proxy exists, the product shows photos only; if loading fails, the viewer shows an error.
- **Public media serves raster images only.** `/media/*` only serves keys matching `PUBLIC_MEDIA_KEY` (`products|categories/YYYY/MM/<uuid>.(jpg|jpeg|png|webp|avif)`). `preview-proxies/`, legacy `previews/…glb`, `digital/`, `uploads/` and old `turntables/` keys return 404.
- **Legacy GLBs** (`products.preview_model_key`, from the first 3D viewer; for digital products they could be the paid geometry) are never served. Admin → "Check legacy GLB" runs the validator and records the result in the audit log; it never publishes, moves or deletes the file. Old turntable frames (migration 0003) stay stored but are no longer shown; an admin can delete them per product.
- **Viewer:** `@google/model-viewer` 4.3.1 (pinned), loaded only after the visitor presses "Load 3D preview". Proxies use no Draco/meshopt/KTX2, so no decoder or WebAssembly is fetched and the CSP still does **not** allow `wasm-unsafe-eval` or any third-party origin.
- **Paid files** live only in `PRIVATE_FILES` under random keys. `/api/downloads/{orderItemId}/{fileId}` requires a session, ownership of the order item, a PAID order that is not cancelled or returned, a file that belongs to that product and is active, and a per-item download cap. It responds `Content-Disposition: attachment`, `Cache-Control: private, no-store`. No storage key, signed URL or public URL is ever sent to the browser.
- **What remains possible (be honest about this):** anything a browser renders can be extracted. A visitor can save the approved proxy GLB and print or edit it. It is a coarse, unit-scaled shape without fine detail, but it is the overall shape. Approve only proxies you are comfortable giving away at that level of detail, and use the "Low" detail setting for designs whose silhouette is the value. Buyers can share files they bought. A bucket misconfiguration on Cloudflare (making `PRIVATE_FILES` public) would bypass the app; keep both buckets private (docs/PRODUCTION_SETUP.md step 3).
- **Tests:** `tests/integration/model-protection.test.ts` (content-based validator against raw originals, STL/HTML/random bytes renamed `.glb`, textures/extensions/external buffers; reduction, unit size, hash difference, separate storage; copy-of-original refused by the app and by the trigger; not-reduced uploads refused; only approved + published served; pending, rejected, withdrawn, draft and archived are 404; id manipulation and traversal; swapped object refused; one approved per product; `/media` allowlist; legacy audit publishes and deletes nothing; storefront data carries only `/api/previews/<id>`; permissions; migration 0004 additive; paid download authorization) and `e2e/model-protection.spec.ts` + `e2e/preview-admin.spec.ts` (network capture on paid-model pages: exactly one model response, the approved proxy, hash equal to the approved row and different from the original, ≤ 50 % triangles; no CSP violations; Arabic phone touch viewer; storage probes; admin generate → review → approve → withdraw; Operations cannot approve).

## Rate limiting

Fixed‑window counters in D1 (`src/server/services/rate-limit.ts`). D1 is a single primary, so counters are global across isolates and locations, unlike in‑memory maps.

Iraqi mobile carriers use carrier‑grade NAT, where many customers can share one IP. Customer‑facing limits are therefore keyed on the **visitor cookie or account**, with a looser **per‑IP ceiling** as a backstop against cookie cycling. Credential‑guessing limits stay strict per target (phone, admin account).

| Bucket | Per visitor / account / target | Per IP backstop |
|---|---|---|
| Customer login | 5 / 15 min per phone | 40 / 15 min |
| Registration | n/a | 20 / h |
| SMS sends (register, unverified sign-in, recovery, resend) | 3 / h per phone | 20 / h |
| SMS code checks | 5 per challenge | 30 / 15 min |
| Deposit reference submission | 10 / h per order | 10 / h |
| Telegram test message | 5 / 10 min per admin | n/a |
| Password reset / change | 10 / h per account | 10 / h (reset) |
| Admin login / TOTP | account lockout (5 wrong → 15 min) and 5 codes per MFA session | 10 / 15 min |
| Checkout | 10 / 10 min | 100 / 10 min (discount preview included) |
| Cart writes | 120 / 10 min | 1,000 / 10 min |
| Uploads | 20 / h (30 unattached max) | 150 / h |
| Custom requests | 5 / h | 40 / h |
| Quote accept/decline | n/a | 30 / h |
| Contact form | 3 / h per email | 10 / h (plus honeypot and fill-time check) |
| Downloads | 60 / h per user | n/a |

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
- Phone verification and SMS recovery are inactive until Twilio credentials are configured (registration is disabled meanwhile).
- All payments are verified manually by an Owner; no payment provider API is integrated (the FIB adapter was retired).
- No automated malware scanning of uploaded archives (files are never executed or served inline).
- Per‑IP backstops can still throttle very large groups behind one carrier NAT; tune the numbers in `rate-limit.ts` from real traffic.
