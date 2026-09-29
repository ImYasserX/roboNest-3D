# Architecture

RoboNest.3D is a single Next.js application deployed as one Cloudflare Worker. The goal was the smallest architecture that can legitimately run a small Iraqi e‑commerce business: no separate API server, no queue, no third‑party auth or payment service.

```
Browser ──HTTPS──> Cloudflare edge
                     │  (Image Transformations for /cdn-cgi/image, optional)
                     ▼
               Worker: Next.js 16 via OpenNext
               ├─ middleware.ts      locale, CSP nonce, CSRF origin check, admin gate
               ├─ Server Components  pages (all rendered per request)
               ├─ Server Actions     mutations (validate → authorize → service)
               ├─ Route handlers     /api/uploads, /api/downloads, /api/admin/*, /media/*
               └─ server/services    business logic ──> D1 (SQLite)  ──> R2 MEDIA / R2 PRIVATE_FILES
```

## Technology decisions

| Decision | Choice | Why | Alternatives considered |
|---|---|---|---|
| Hosting | Cloudflare Workers + OpenNext adapter | The brief's target platform; the existing RoboNest site already runs this way; global edge, low cost, no servers to patch | Vercel (not Cloudflare), a VPS (operational burden) |
| Database | **Cloudflare D1** (SQLite) + Drizzle ORM | Native binding (no network credentials to leak), free/low‑cost tiers fit a small shop, point‑in‑time recovery (Time Travel), real SQL with foreign keys, CHECK and UNIQUE constraints. Drizzle gives typed, parameterized queries and SQL migrations. | Postgres (Neon/Supabase) adds an external service and connection credentials; Turso/libSQL adds a vendor; Firebase explicitly discouraged and a poor fit for relational orders |
| Object storage | **Cloudflare R2**, two buckets | Same account and bindings, no egress fees. `MEDIA` for public catalog media, `PRIVATE_FILES` for paid downloads and customer uploads. Splitting them means a routing bug cannot expose private files through the public media route. | S3 (credentials and egress), Cloudflare Images for storage (per‑image cost, no private files) |
| Validation | Zod at every boundary | Runtime validation of forms, query strings, route params, and file metadata; TypeScript alone does not protect runtime input | — |
| i18n | next‑intl, `/ar` and `/en` path prefixes | One component tree, no duplicated pages; `lang`/`dir` set on `<html>`; locale‑aware metadata and hreflang | Cookie‑only locale (not crawlable), duplicated route trees |
| Styling | Tailwind 4 with CSS‑variable design tokens (`src/app/globals.css`) | Every color is a token; the storefront uses the dark brand theme and the admin opts into a light theme; all text pairs checked for WCAG AA contrast | — |
| Auth | Own implementation: opaque session tokens in D1, PBKDF2 (WebCrypto), TOTP for admins | Two user types with very different needs, no external IdP, everything runs natively in Workers. Details in `SECURITY.md`. | Auth SaaS (cost, customer data leaves the platform), JWT sessions (not revocable) |

### Why D1 needs care

D1 has **no interactive transactions** and allows **at most 100 bound parameters per statement**. The code is built around both:

- **Atomic writes use `db.batch()`**, which runs as one implicit transaction and rolls back entirely on any error (verified in `tests/integration/d1-semantics.test.ts`).
- **Concurrency invariants are CHECK constraints**, so a batch fails atomically instead of relying on read‑then‑write:
  - `products.stock_quantity >= 0`: two checkouts racing for the last unit cannot both succeed.
  - `discounts.used_count <= max_uses`: usage limits hold under concurrency.
  - `orders.total = subtotal − discount + delivery` and `order_items.line_total = unit_price × quantity`: the database rejects inconsistent money rows.
- **Compare‑and‑set updates** (`UPDATE … WHERE status = expected`) guard admin status changes, quote acceptance, TOTP replay counters, and download counters.
- Multi‑row inserts are split per row and long `IN` lists are chunked (`chunk()` in `server/db/client.ts`), because of the 100‑parameter limit. A 20‑line checkout is covered by a test.
- Correlated subqueries use `qualified(column)` (`server/db/sql.ts`). Drizzle omits table names in single‑table selects, which makes `"id"` bind to the wrong table inside subqueries. Tests pin the resulting counts.

## Data model

Schema: `src/server/db/schema.ts` (one migration: `drizzle/migrations/0000_init.sql`). Money is always **integer whole IQD**. Timestamps are integer milliseconds. Bilingual content uses explicit `*_en`/`*_ar` columns.

| Area | Tables | Notes |
|---|---|---|
| Customers | `users`, `sessions`, `password_reset_tokens`, `addresses` | Phone numbers stored normalized (E.164 `+9647…`); sessions and reset tokens stored only as SHA‑256 hashes |
| Admins | `admin_users`, `admin_sessions` | Separate identity store; TOTP secret AES‑GCM encrypted; lockout counters |
| Catalog | `categories` (2‑level tree), `products`, `product_images`, `product_options`, `product_option_values`, `product_relations`, `digital_files` | Materials/colours/tags are JSON arrays queried with `json_each`; `search_text` holds normalized EN+AR text |
| Delivery | `delivery_zones` (19 governorates), `delivery_areas` (per‑area fee overrides) | Fees are data, editable in the admin, never hard‑coded |
| Commerce | `carts`, `cart_items`, `discounts`, `orders`, `order_items`, `order_status_history` | Order items **snapshot** name, slug, type, image, unit price, unit cost, and selected options; history records actor and optional public note |
| Custom printing | `custom_print_requests`, `uploads` | Uploads are owned by a user or anonymous visitor until attached to an order or request |
| Operations | `site_settings` (typed, Zod‑validated JSON), `audit_logs`, `rate_limits`, `contact_messages`, `wishlist_items` | |

Deliberate simplifications (documented rather than hidden):

- **Variants are option combinations.** Material, colour, and size are configurable options with price deltas. There is no separate SKU/variant table because stock for made‑to‑order goods is not per variant. In‑stock quantity is tracked per product.
- **One category per product** (a leaf or a top‑level category). Filtering by a parent includes its children.
- **Roles and permissions live in code** (`src/lib/permissions.ts`). There are exactly two fixed roles, and a code‑reviewed map is safer than runtime‑editable permission tables.
- **No reviews table.** Reviews were optional in the brief and were not implemented, so no review schema or ratings are emitted.

## Business logic

All rules that affect money or access live in framework‑free modules that are unit‑tested:

- `src/lib/pricing.ts`: `resolveLine` validates every option type (select, radio, checkbox groups, single checkbox, number with range and per‑unit price, text/textarea with length and control‑character checks, file references) and computes the unit price. Plus `evaluateDiscount`, `resolveDeliveryFee`, `computeTotals`. The client imports the same module **only for a live preview**; the server recomputes on every cart read and at checkout, and client‑sent prices are never accepted.
- `src/lib/order-status.ts`: the order lifecycle below and the custom‑request lifecycle.
- `src/lib/permissions.ts`: role → permission map.

### Order lifecycle

```
PENDING → CONFIRMED → IN_PRODUCTION → QUALITY_CHECK → READY_FOR_DELIVERY → OUT_FOR_DELIVERY → DELIVERED
   │          │  └──────────── (in-stock items skip production) ──────┘            │               │
   │          └─ DELIVERED (digital-only orders)                             FAILED_DELIVERY    RETURN_REQUESTED
   └─ CANCELLED (from any pre-delivery state)                            (retry/return/cancel)    → RETURNED
```

`PROCESSING` from the brief was dropped as redundant with `CONFIRMED`/`IN_PRODUCTION`. Side effects: `DELIVERED` sets COD payment to `PAID`; `CANCELLED`/`RETURNED` restore stock (only for lines that decremented it) and `CANCELLED` releases the discount use. Every change writes `order_status_history` and an audit log entry.

### Checkout

`placeOrder` (`src/server/services/orders.ts`):

1. Zod‑validates the form (Iraqi mobile normalization, bounded lengths, no control characters).
2. Derives an **idempotency key** as SHA‑256 of the cart owner plus a per‑page‑render UUID. A repeat submit (double click, retry, refresh) returns the original order, and a racing duplicate loses on the unique index.
3. Re‑prices the cart from the database and rejects invalid lines.
4. Requires an account if the cart has digital items.
5. Computes the delivery fee from the zone/area rows and evaluates the discount.
6. Writes the order, per‑row items, history, stock decrements, discount usage, upload attachment, and cart clearing in **one batch**.

Payment method is always `COD` and payment status starts `PENDING`; nothing claims payment was taken.

### Custom printing

Customer uploads (streamed, sniffed, size‑limited) → request `SUBMITTED` → staff review (`IN_REVIEW`, `QUOTED` with price and production days, or `REJECTED`) → the customer accepts, which creates a real COD order priced at the quote plus the delivery fee, in one batch, idempotent per request. Or the customer declines. Customers see status and the quote at `/custom-printing/requests/{number}` using the secret link token or their account.

### Digital products

Files live in `PRIVATE_FILES`. `/api/downloads/{orderItemId}/{fileId}` checks the session, order ownership, `payment_status = PAID`, that the order was not cancelled or returned, that the file belongs to the purchased product and is active, and a per‑item cap of 25 downloads (atomic increment). It then streams the object as an attachment. No signed or public URL exists, and R2 credentials never exist in the app (bindings only).

For digital‑only orders the payment method is still COD by design: staff arrange payment and mark the order paid, which unlocks the downloads. The checkout says so explicitly.

## Rendering, caching, performance

- **All pages render per request** (`dynamic = "force-dynamic"` on the locale layout). Prices, stock, sessions, and carts are live data, and OpenNext without an R2/KV incremental cache cannot revalidate static pages. The build never touches the database. Enabling ISR later requires an OpenNext cache binding and careful exclusion of personalized pages.
- Server Components by default. Client components are limited to the configurator, gallery, forms, menus, and charts.
- `<model-viewer>` (~1 MB) and the GLB file load **only when the visitor asks** for the 3D preview.
- Images: `next/image` with a custom loader (`src/lib/image-loader.ts`). With `NEXT_PUBLIC_IMAGE_TRANSFORMS=cloudflare`, requests go through Cloudflare Image Transformations (resize plus AVIF/WebP negotiation) from the R2 original. OpenNext's built‑in optimizer only reads static assets, not the R2‑backed `/media` route. Media keys are random UUIDs, so responses are cached `immutable` for a year. All product imagery sits in fixed aspect‑ratio boxes, so CLS was measured at 0.
- Lists are paginated server‑side (24 per page storefront, 25 admin). Admin tables never load all rows.
- Search is `LIKE` over a normalized EN+AR `search_text` column (Arabic letter variants and diacritics folded) with escaped wildcards. That is adequate for hundreds or low thousands of products. FTS5 is supported by D1 but was avoided because virtual tables complicate `wrangler d1 export` backups.

## Internationalization and RTL

- Routes are `/{ar|en}/…`. The default locale is Arabic, negotiated from `Accept-Language`, with a cookie `rn_locale`. The language switcher keeps the current path and query.
- All UI strings are in `messages/{ar,en}.json` (1,064 keys each). `npm test` fails if the key sets differ or a value is empty.
- Layout uses logical properties (`ms-`, `pe-`, `start-`, `end-`) so RTL mirrors without per‑component overrides. Directional icons flip with `rtl:`. Numbers, prices, phones, and order numbers are bidi‑isolated (`.ltr-nums`, `<bdi>`), and amounts use a non‑breaking space before the currency.
- Arabic copy uses clear Iraqi phrasing where natural (e.g. «أقرب نقطة دالة», «المحلة», «الزقاق», «رقم الدار», «هسه») and standard Arabic for legal and error text.
- Fonts: Inter and Manrope (Latin), IBM Plex Sans Arabic (Arabic), self‑hosted by `next/font`.

## Middleware choice

Next 16 renames `middleware.ts` to `proxy.ts` and runs the proxy on the Node runtime. OpenNext's Cloudflare adapter supports Node middleware only experimentally ("not officially maintained"). The project therefore keeps the Edge `middleware.ts` convention (deprecated but supported), which uses only Web APIs. Revisit when OpenNext supports `proxy.ts` officially; the migration is a rename.

## Deployment preparation

**Not performed.** These steps are prepared for when the business is ready:

1. `npx wrangler login`, then create resources:
   `npx wrangler d1 create robonest-3d` (put the printed `database_id` in `wrangler.jsonc`),
   `npx wrangler r2 bucket create robonest-3d-media`, `npx wrangler r2 bucket create robonest-3d-private`.
   Keep both buckets **without** public access or `r2.dev` URLs.
2. Secrets and vars: `npx wrangler secret put APP_SECRET` (≥ 32 random chars, e.g. `openssl rand -base64 48`). Set `SITE_URL` in `wrangler.jsonc` `vars` to the real HTTPS origin.
3. Enable **Image Transformations** on the zone and build with `NEXT_PUBLIC_IMAGE_TRANSFORMS=cloudflare`.
4. `npx wrangler d1 migrations apply robonest-3d --remote`.
5. Create the two admin accounts in production **without** the development seed: run `npm run admin:create` twice (it prompts for username, role and password and writes a git‑ignored `.admin-insert.sql` holding only the PBKDF2 hash), apply each with `npx wrangler d1 execute robonest-3d --remote --file=.admin-insert.sql`, then delete the file. Never run `db:seed` against production. The Super Admin enrolls TOTP at first sign‑in.
6. In the admin: set delivery fees per governorate (the seeded values are placeholders), WhatsApp/phone/email, homepage copy, custom‑print materials, and real products and photos. Delete or archive the sample products.
7. `npm run cf:build`, then deploy (`npx opennextjs-cloudflare deploy`), then attach the custom domain.
8. Post‑deploy smoke test: E2E suite with `E2E_BASE_URL` pointed at a staging copy (it reseeds, so **never** run it against production data).
9. Optional hardening: a Cloudflare WAF rate‑limiting rule for `/*/admin/login` and `/api/*` in addition to the app's D1 counters; Cloudflare Access in front of `/*/admin`.
