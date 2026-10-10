# Final audit: RoboNest.3D

> **Update 2026-10-10.** This report describes the 2026-09-24 build. Since then: the public "track an order" page was removed; delivery is a flat 5,000 IQD everywhere; orders above 50,000 IQD require a manually verified deposit (new `AWAITING_DEPOSIT` / `DEPOSIT_SUBMITTED` / `DEPOSIT_VERIFIED` states); an `OWNER` role with database-enforced protection was added; phone verification and SMS recovery (Twilio Verify, inactive until configured) replaced "phones are not verified"; Telegram order alerts use an outbox table; the contact form sends through Resend; a light/dark/system theme was added; policies were rewritten without unapproved claims. Known issues 2, 3 and 4 below are addressed by code but depend on credentials. See README (Environment), ARCHITECTURE (Delivery and deposits, Notifications), SECURITY and TESTING for the current state; migration `0001_owners_deposits_notifications.sql` holds the schema changes.

**Date:** 2026‑09‑24 · **Scope:** the complete application in this repository · **Deployment:** **not performed** (by instruction). No Cloudflare resources were created, and no domains or DNS were touched.

**Verdict:** the application is feature‑complete for the brief and passed every automated check listed below, including the full commerce journey on the production Worker bundle. It is **not yet production‑ready**: the business must resolve the items under [Production blockers](#production-blockers) first. None of them are code defects known to exist; they are configuration, content, and review tasks that cannot be completed inside the repository.

Status words used below: **PASSED** (executed, succeeded), **FAILED** (executed, failed), **NOT TESTED** (not executed), **PARTIAL** (some aspects executed).

---

## Architecture

A single Next.js 16 (App Router, TypeScript) application built with OpenNext into one Cloudflare Worker, with no separate API server, queue, or third‑party auth/payment service.

- **Server Components** render all pages per request, because prices, stock, carts, and sessions are live.
- **Server Actions** handle mutations.
- **Route handlers** serve uploads, downloads, and media.
- **Framework‑free service modules** hold all business logic, so it is tested directly against the real database engine.
- **Middleware** handles locale routing (`/ar`, `/en`), per‑request CSP nonces, the same‑origin check on mutations, and a coarse admin gate.

Rationale and trade‑offs are in `ARCHITECTURE.md`.

## Database

**Cloudflare D1 (SQLite) with Drizzle ORM** and SQL migrations (`drizzle/migrations/0000_init.sql`, applied by Wrangler). It has 28 tables:
- **Customers:** `users`, `sessions`, `password_reset_tokens`, `addresses`
- **Admins:** `admin_users`, `admin_sessions`
- **Catalog:** `categories`, `products`, `product_images`, `product_options`, `product_option_values`, `product_relations`, `digital_files`
- **Delivery:** `delivery_zones`, `delivery_areas`
- **Commerce:** `carts`, `cart_items`, `discounts`, `orders`, `order_items`, `order_status_history`
- **Custom printing:** `custom_print_requests`, `uploads`
- **Operations:** `site_settings`, `audit_logs`, `rate_limits`, `contact_messages`, `wishlist_items`

The schema uses foreign keys with deliberate cascade, restrict, or set‑null behaviour, plus unique indexes (slugs, phone, username, order number, idempotency key, discount code) and query indexes.

CHECK constraints encode the money and concurrency invariants:
- non‑negative stock, prices, and fees;
- discount usage ≤ limit;
- `total = subtotal − discount + delivery`;
- `line_total = unit_price × quantity`.

Money is integer whole IQD. Order items snapshot the product and options.

## Authentication

- **Customers:** phone number (normalized `+9647…`) and password, hashed with PBKDF2‑SHA256 at 100k iterations via WebCrypto (the Cloudflare maximum; see Known issues). Opaque 256‑bit session tokens are stored as SHA‑256 hashes in `__Host-` cookies (`HttpOnly`, `Secure`, `SameSite=Lax`) with a 30‑day expiry. Tokens rotate on sign‑in and all sessions are revoked on password change or reset. Sign‑in errors are generic and timing‑equalized. Guest checkout is supported for physical goods.
- **Administrators:** a separate identity store and cookie (`SameSite=Strict`), a password, and TOTP. **TOTP is mandatory for the Super Admin** and optional for Operations unless the Super Admin enforces it for everyone. Sign‑in is two‑step (a pending MFA session, then a fresh active session). TOTP secrets are AES‑GCM encrypted and codes are replay‑protected. Accounts lock after 5 wrong passwords, and sessions have 12 h absolute and 2 h idle timeouts.

## Authorization

Two fixed roles in a code‑reviewed permission map (`src/lib/permissions.ts`). Operations cannot manage admins, security settings, the audit log, discounts, profit data, or permanent deletions.

Enforcement is server‑side:
- every admin page calls `requireAdminPage(permission)`;
- every admin action runs through `withAdmin(permission)`;
- every admin route handler calls `requireAdminAction`.

Customer data is scoped by ownership in the query itself (user ID, secret link token, or number + phone lookup). The UI hides controls only as a convenience.

## Storage

Two private R2 buckets. **MEDIA** holds product images and GLB previews, served only via `/media/*` for app‑generated UUID keys, cached as immutable, with `nosniff` and a sandbox CSP. **PRIVATE_FILES** holds digital products and customer uploads, returned only by authorization‑checked routes as attachments.

Uploads are streamed with length enforcement, validated by extension allowlist and magic bytes, size‑capped per purpose, and stored under random keys that are never derived from filenames. Images are resized at the edge by Cloudflare Image Transformations when enabled. No storage credentials exist in the code; everything goes through bindings.

## Ecommerce

- **Catalog:** hierarchical categories; five product types; five availability states (made‑to‑order is never blocked by stock).
- **Product options:** configurable per product (select, radio, checkbox, number with per‑unit pricing, text, textarea, file) with price deltas, ranges, and required flags. Images come with bilingual alt text, plus an optional GLB 3D preview and private digital files.
- **Pricing:** computed on the server (`resolveLine`) on every cart read and at checkout. Client prices are ignored.
- **Cart:** persistent in D1, keyed by account or anonymous visitor cookie, and merged at sign‑in.
- **Checkout:** built for Iraq (governorate, area, city, mahalla, street, nearest landmark, notes). It supports discount codes, and **cash on delivery only** (`payment_method = COD`, `payment_status = PENDING`, no fake gateway). It is idempotent and atomic, and the delivery fee comes from admin‑editable zone and area tables.
- **Orders:** an 11‑state validated lifecycle with history, actor, and public notes. Customers follow progress via their account or a secret link, or by looking up order number + phone.
- **Custom printing:** upload → staff quote → the customer accepts, which creates a real COD order, or declines.
- **Digital downloads:** unlocked when the order is paid, capped per purchase.
- **Admin:** dashboard, orders, custom requests, products (editor, options, images, preview, files), categories, inventory, digital files, customers (including staff‑assisted reset links), messages, delivery prices, discounts, analytics (revenue, delivery, products, customers, and profit for the Super Admin only), content, settings, admin users, audit log. The whole admin is bilingual and RTL‑aware.

---

## Security

| Check | Result | Evidence |
|---|---|---|
| SQL injection | **PASSED** | All queries parameterized via Drizzle; `LIKE` escaping; hostile query params test (`catalog.test.ts`) |
| XSS | **PASSED** | React escaping; JSON‑LD `<` and U+2028/9 escaped; no HTML descriptions; SVG uploads refused; `javascript:` URL setting rejected (test) |
| Command/template injection | **PASSED** (by design) | No shell execution or server templating of input |
| Password hashing | **PASSED** with trade‑off | PBKDF2 100k (platform cap); unit tests |
| Session security / fixation / expiry | **PASSED** | Hashed tokens, rotation on login, revocation tests, idle and absolute expiry tests |
| Account enumeration | **PASSED** (login) / accepted (registration) | Identical errors plus dummy hash; lockout reveals nothing to wrong passwords (test) |
| Authentication bypass | **PASSED** | Anonymous `/admin` → login; admin APIs → 401 (HTTP check on the Worker) |
| IDOR (orders, carts, uploads, requests, downloads) | **PASSED** | Integration tests plus E2E (another customer's order 404s) |
| Privilege escalation | **PASSED** | E2E: Operations refused on 4 Super‑Admin areas; action guard on every admin mutation; unit tests |
| Unauthorized digital downloads | **PASSED** | Unpaid, stranger, foreign file, cap, and cancelled order all refused (test); no session → redirect to login (HTTP) |
| CSRF | **PASSED** | Cross‑origin POST → 403; Origin‑less POST → 403 (HTTP check); SameSite cookies |
| Rate limiting | **PASSED** | D1 counters on every sensitive endpoint; window test; keyed per visitor/account with IP backstops (CGNAT‑aware) |
| File uploads | **PASSED** | Renamed HTML as `.stl` → 415; `.exe` → 415; 53 MB → 413; traversal filename sanitized; unit tests for signatures |
| Path traversal / private exposure | **PASSED** | `/media/..%2F…`, `/media/digital/…`, `/media/uploads/…` → 404 |
| Open redirects | **PASSED** | `safeRedirectPath` unit tests |
| Cookie flags | **PASSED** | `__Host-…; Secure; HttpOnly; SameSite=lax` observed on the Worker |
| Security headers | **PASSED** | CSP (nonce, strict‑dynamic, `wasm-unsafe-eval` only), HSTS, nosniff, `X-Frame-Options`, Referrer‑Policy, Permissions‑Policy, COOP observed on the Worker |
| Secrets in repo / client / logs | **PASSED** | Repository scan (only throwaway E2E fixtures); client bundle scan clean; no `NEXT_PUBLIC` secrets; no published source maps; audit metadata scrubbing test |
| Error disclosure | **PASSED** | Generic error pages with digest only; services return codes |
| Client price/role/ownership manipulation | **PASSED** | Tampered `total`/`price`/`deliveryFee` ignored (test); roles come from the server session only |
| Duplicate orders / races | **PASSED** | Concurrent double submit → one order; concurrent last‑unit checkout → one success; discount limit under race (tests); E2E double‑click |
| Dependency vulnerabilities | **PASSED** (runtime) | `npm audit --omit=dev`: 0. `npm audit`: 4 moderate, dev‑only (`drizzle-kit` → esbuild 0.18), not in the Worker |
| Malware scanning of uploads | **NOT TESTED** / not implemented | Files are never executed or served inline; see Known issues |
| External penetration test | **NOT TESTED** | Recommended before launch |

## Accessibility

| Check | Result | Notes |
|---|---|---|
| Automated axe (WCAG 2.0/2.1/2.2 A/AA) | **PASSED** | 28 E2E tests: 13 public pages × 2 locales, 10 admin pages, 6 signed‑in customer pages; zero serious or critical violations after fixes (step‑number contrast, light‑theme status inks) |
| Lighthouse accessibility | **PASSED** | 100 on home and product pages (local) |
| Colour contrast | **PASSED** | Palette computed with a script (text ≥ 6.8:1 dark, ≥ 5.3:1 light badges on tinted fills, input borders ≥ 3:1) |
| Form labels, errors, `aria-describedby`, `aria-invalid` | **PASSED** | Shared `Field` components; axe clean |
| Semantic structure, one `h1` per page, landmarks, skip link | **PASSED** | Reviewed and axe clean |
| Keyboard | **PARTIAL** | Native controls, visible focus ring, focus moved to checkout errors, keyboard navigation of chart bars; no full manual keyboard‑only walkthrough of every page |
| Dialog focus trapping | **PASSED** (by design) | Mobile menu uses native `<dialog>` `showModal()` |
| Reduced motion | **PASSED** | Global `prefers-reduced-motion` rule |
| Status not by colour alone | **PASSED** | Every badge carries text; progress steps carry text plus an sr‑only state |
| Touch targets | **PASSED** | ≥ 40 px on mobile header controls, ≥ 44 px on primary controls |
| Screen readers (NVDA, VoiceOver, TalkBack) | **NOT TESTED** | |
| RTL accessibility | **PARTIAL** | `lang="ar-IQ" dir="rtl"`, bidi isolation, and Arabic axe runs passed; not tested with an Arabic screen reader |

## SEO

| Check | Result |
|---|---|
| Unique title and description per page (listing, product, category, content) | **PASSED** |
| Canonical plus hreflang (`ar-IQ`, `en`, `x-default`) | **PASSED**: absolute URLs from `SITE_URL` (must equal the production origin) |
| Filtered, search, cart, account, order, and admin pages `noindex` | **PASSED** |
| Open Graph / Twitter metadata | **PASSED** (products include the primary image) |
| JSON‑LD: Organization, WebSite+SearchAction, Product+Offer (IQD, availability incl. MadeToOrder/PreOrder), BreadcrumbList, FAQPage | **PASSED** (generated). **NOT TESTED** in Google's Rich Results Test (needs a public URL) |
| No fake ratings or reviews | **PASSED** (no review data exists) |
| `sitemap.xml` (90 URLs, both locales, alternates) and `robots.txt` | **PASSED** |
| 404 behaviour (real 404 status, branded page) | **PASSED** |
| Lighthouse SEO | 92 locally: the only failure was the canonical pointing to `SITE_URL` (`:3000`) while the test Worker ran on `:8787`, which is correct behaviour for a mismatched environment |

## Performance

| Check | Result |
|---|---|
| Lighthouse (mobile emulation, local Worker over HTTP) | **PASSED with notes**: Home: performance 82, CLS 0, LCP 3.3 s, TBT 340 ms. Product: 86, CLS 0, LCP 3.5 s, TBT 210 ms. Local numbers include throttling and no edge caching or image transforms |
| CLS | **PASSED**: 0 (fixed aspect‑ratio media, font `swap`) |
| Image delivery | **PARTIAL**: resizing and AVIF/WebP depend on Cloudflare Image Transformations (flagged locally as "improve image delivery") |
| Code splitting | **PASSED**: `<model-viewer>` and GLB load only on demand; Server Components by default |
| Worker size | **PASSED**: 2.64 MB gzip (dry run, nothing uploaded) |
| Pagination and query efficiency | **PASSED**: server‑side pagination everywhere; indexed filters |
| Real‑world Core Web Vitals on Cloudflare | **NOT TESTED** |

---

## Tests: commands executed and results

All commands below were executed on the final code on 2026‑09‑24.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASSED** (exit 0, no errors) |
| `npx eslint .` | **PASSED** (exit 0, 0 problems) |
| `npm test` (i18n parity + Vitest) | **PASSED**: `i18n OK: 1064 keys in both locales`; **79 tests passed** (unit 40, integration 39) |
| `npm run cf:build` (`next build` + OpenNext) | **PASSED**: 0 warnings, "OpenNext build complete", 67 routes |
| `npx playwright test` against the built Worker in workerd | **PASSED**: **45 passed** (7 commerce journeys, 28 accessibility scans, 10 responsive sweeps) |
| `npm audit --omit=dev` | **PASSED**: 0 vulnerabilities |
| `npm audit` | 4 moderate (dev‑only, `drizzle-kit`'s esbuild) |
| `npx wrangler deploy --dry-run` | **PASSED**: 13.6 MB raw / 2.64 MB gzip; nothing deployed |
| HTTP security probes with `curl` against the Worker | **PASSED** (see Security) |
| Lighthouse 12 (home, product) | Executed; results above |
| `npm run admin:create` (piped input, local D1) | **PASSED**: inserted admin with PBKDF2 hash; invalid username rejected |
| Screen reader, Safari/Firefox, physical devices, load test, Rich Results Test | **NOT TESTED** |

Defects found by these tests and fixed during the build:
- Drizzle correlated subqueries binding to the wrong table;
- D1's 100‑parameter limit on multi‑line orders;
- the `acceptQuote` foreign‑key ordering;
- a product‑form crash on omitted optional fields;
- React 19 form reset wiping user input after validation errors;
- mobile header overflow at 375 px;
- RTL bidi scrambling of "price × qty";
- two contrast issues;
- a Turbopack regex‑escaping build bug (worked around);
- Node‑middleware being experimental on OpenNext (switched to Edge middleware).

## Routes

Verified to resolve (HTTP status and/or E2E render) in **both** `/ar` and `/en`.

- **Storefront:**
  - home, `/products`, `/products/[slug]` (404 for unknown), `/categories`, `/categories/[slug]` (404 for unknown), `/search`, `/models`
  - `/custom-printing`, `/custom-printing/requests/[number]`, `/cart`, `/checkout` (redirects to cart when empty; sign‑in prompt for digital), `/orders/[number]` (token or owner), `/track`
  - `/login`, `/register`, `/forgot-password`, `/reset-password/[token]` (invalid‑token state)
  - `/account` (redirects to login when anonymous), `/account/orders`, `/account/orders/[number]`, `/account/downloads`, `/account/custom-requests`, `/account/security`, `/wishlist`
  - `/about`, `/contact`, `/faq`, `/delivery`, `/returns`, `/privacy`, `/terms`, unknown paths (branded 404)
- **Admin**, all 20 verified as Super Admin and Operations (`/admin/...`):
  - dashboard, `orders`, `orders/[id]`, `custom-requests`, `custom-requests/[id]`, `products`, `products/new`, `products/[id]`, `categories`, `inventory`
  - `digital-files`, `customers`, `customers/[id]`, `messages`, `delivery`, `discounts`, `analytics`, `content`, `settings`, `admins`
  - `audit-log`, `security`, `forbidden`, `login`, `login/verify`
- **API and system:** `/api/uploads`, `/api/downloads/[itemId]/[fileId]`, `/api/admin/uploads`, `/api/admin/files/[uploadId]`, `/media/[...key]`, `/sitemap.xml`, `/robots.txt`, icons.
- **Link audit:** no `href="#"`. Every navigation, footer, and policy link points to an existing route, and every button submits a real action or opens a real UI.

---

## Known issues

1. **Password hashing strength:** PBKDF2 at 100k iterations (Cloudflare's WebCrypto cap) is below OWASP's 600k recommendation. It is mitigated by lockout, rate limits, and TOTP for admins. The format supports upgrading.
2. **Phone numbers are not verified.** There is no SMS/OTP provider, so anyone can register any number, and registration reveals whether a number already has an account (rate‑limited).
3. **Password recovery is staff‑assisted** (a single‑use link sent over WhatsApp), not self‑service.
4. **No automatic notifications.** Customers see status changes on their order page, but no SMS, WhatsApp, or email is sent automatically. Staff can message customers from the order screen (WhatsApp link).
5. **Unattached uploads are not purged automatically.** Files uploaded but never attached to an order or request stay in R2. They are capped (30 per owner, size limits), and a scheduled cleanup (Cron Trigger) is a recommended follow‑up.
6. **No malware or zip scanning** of customer uploads. They are only stored and downloaded as attachments by staff; staff should open archives with care.
7. **Reviews are not implemented** (optional in the brief). **The wishlist requires sign‑in** (no guest wishlist).
8. **Compressed GLB previews** (Draco/KTX2) will not load: `<model-viewer>` would fetch decoders from a CDN, which the CSP blocks. Upload uncompressed or meshopt GLBs (the admin hint says so), or self‑host the decoders.
9. **Digital‑only orders use a manual COD‑style payment step** (staff mark them paid). This is intentional for a cash‑only business, but it adds a manual step.
10. **Search is `LIKE`‑based** over normalized text. It is fine for hundreds to low thousands of products; consider FTS5 or an external index at larger scale.
11. **Edge `middleware.ts`** uses a convention deprecated in Next 16, chosen because OpenNext's Node `proxy.ts` support is experimental. Revisit when that support is official.
12. **Rate‑limit numbers are estimates.** They are CGNAT‑aware (keyed per visitor/account with IP backstops) but should be tuned from real traffic.
13. **Local‑only Lighthouse notes:** a favicon error from `upgrade-insecure-requests` on plain HTTP, and the canonical/`SITE_URL` port mismatch. Neither occurs over HTTPS with a correct `SITE_URL`.

## Production blockers

These **must** be resolved before launch:

1. **Cloudflare Workers Paid plan (≈ $5/month) is required.** The Free plan's 10 ms CPU limit per request cannot run PBKDF2 sign‑in and registration.
2. **Create the production resources and configuration:** the D1 database (real `database_id` in `wrangler.jsonc`), both R2 buckets (no public access), the `APP_SECRET` secret, and `SITE_URL` set to the real HTTPS origin. Enable **Image Transformations** and build with `NEXT_PUBLIC_IMAGE_TRANSFORMS=cloudflare`, otherwise full‑size originals (up to 8 MB) are sent to phones. Apply migrations remotely. (Checklist: `ARCHITECTURE.md` → Deployment preparation.)
3. **Replace all sample content.** The products, images, 3D files, and **delivery fees** are development placeholders. Configure real per‑governorate fees, real products and photos, WhatsApp/phone/email, and homepage copy. Delete or archive the samples, and remove the `WELCOME10` sample discount if it was created in production.
4. **Create the real admin accounts with `npm run admin:create`.** Never run `db:seed` or the E2E suite against production (both wipe data). The Super Admin must enroll TOTP at first sign‑in.
5. **Legal review.** Privacy, terms, and returns pages are sensible templates written for this business model, but they have not been reviewed by a lawyer familiar with Iraqi law.
6. **Arabic copy review by a native Iraqi speaker.** The copy is written in clear Iraqi‑friendly Arabic, but nobody native has reviewed it yet.
7. **Manual QA on real devices and a screen reader** (at least Android Chrome + TalkBack and iOS Safari + VoiceOver, in Arabic) before accepting real orders. These are marked NOT TESTED above.

After these, a staging deployment with the E2E suite pointed at it (`E2E_BASE_URL`, staging data only) is the recommended final gate.
