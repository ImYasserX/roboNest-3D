# Testing

Tests target the failures that would actually hurt this business: wrong prices, oversold stock, duplicate orders, one customer seeing another's data, admins exceeding their role, private files leaking, broken Arabic/RTL, and inaccessible checkout.

## Layers

| Layer | Command | Runs against | Count |
|---|---|---|---|
| i18n parity | `npm run check:i18n` (part of `npm test`) | `messages/*.json` | 1,064 keys × 2 locales |
| Unit | `npm run test:unit` | Pure modules | 40 tests / 5 files |
| Integration | `npm run test:integration` | Real **D1 + R2 engine** (workerd via `getPlatformProxy`, in memory, all migrations applied) | 39 tests / 5 files |
| E2E, accessibility, responsive | `npm run cf:build && npm run test:e2e` | The **production Worker bundle** in workerd (`wrangler dev`), freshly seeded | 45 tests / 3 files |
| Static | `npm run typecheck`, `npm run lint` | Whole repo | — |

`npm test` = i18n parity + unit + integration (79 tests, about 40 s).

### Unit (`tests/unit`)

- **Pricing** (`pricing.test.ts`): every option type, sale‑price rule, unknown/inactive/foreign option values, numeric ranges, quantity bounds (0, −1, 1.5, 101, strings, NaN), text length and control characters, file‑reference format, made‑to‑order vs in‑stock stock rules, canonical selection keys. Also discount maths (flooring, caps, never above subtotal, dates, usage, minimum), delivery area overrides and inactive zones, and total arithmetic.
- **Rules** (`rules.test.ts`): order status transitions (including digital‑only), custom‑request transitions, the permission map (Super vs Operations, unknown roles fail closed), Iraqi phone normalization (local, +964, 00964, Arabic‑Indic digits, rejects landlines and foreign numbers), open‑redirect guard, Arabic search normalization, LIKE escaping, IQD formatting.
- **Crypto** (`crypto.test.ts`, `totp-window.test.ts`): PBKDF2 verify/reject and salt uniqueness; TOTP against the RFC 6238 test vector, drift window, replay rejection; AES‑GCM tamper and purpose separation; constant‑time compare.
- **Files** (`files.test.ts`): magic‑byte sniffing accepts real signatures and rejects renamed executables and HTML/SVG disguised as models; filename sanitization (traversal, Windows paths, bidi overrides, Arabic names); storage keys; public‑media key allowlist; PNG dimension parsing.

### Integration (`tests/integration`)

Each file boots its own in‑memory Miniflare D1/R2 with the real migrations, so foreign keys, CHECK constraints, and batch atomicity behave as in production.

- `d1-semantics`: a batch rolls back entirely when a CHECK constraint fails. Checkout correctness depends on this.
- `checkout`:
  - server‑side pricing and merging identical cart lines;
  - repricing after admin price changes;
  - cart IDOR between visitors;
  - merging a visitor cart into the account cart at sign‑in;
  - a full COD order with snapshots, history, and discount usage, where client‑sent `total`/`price`/`deliveryFee` fields are ignored;
  - snapshots surviving product edits;
  - delivery area override and inactive or unknown zones;
  - **idempotency under concurrent double submit**;
  - **overselling the last unit under concurrency**;
  - discount usage limits;
  - digital products requiring an account, and digital‑only orders without delivery;
  - invalid phone and empty cart;
  - **order access control** (owner, token, phone lookup, and a stranger);
  - customer views excluding internal fields;
  - a 20‑line order (D1's 100‑parameter limit).
- `lifecycle`:
  - the full production pipeline, with COD marked paid on delivery;
  - invalid transitions and stale concurrent updates (compare‑and‑set);
  - cancellation restoring stock and releasing the discount;
  - **digital download authorization** (unpaid, stranger, file from another product, download cap, cancelled order);
  - custom print from submission through quote to a real order (idempotent, then locked);
  - uploads owned by someone else and unknown materials are rejected;
  - declining a quote.
- `auth`:
  - registration with normalized phones and duplicates rejected;
  - an identical error for unknown phone and wrong password;
  - sessions revoked on password change and reset;
  - single‑use and expiring reset tokens;
  - hashed session storage and expiry;
  - admin lockout without username probing;
  - TOTP enrollment, replay rejection, and the MFA attempt cap;
  - idle admin session expiry, and revocation on role change;
  - the last Super Admin protected;
  - rate‑limit windows;
  - audit metadata scrubbing.
- `catalog`:
  - product validation (slug, sale price, stock, negative or fractional prices, duplicates);
  - drafts hidden from the store;
  - ordered products cannot be deleted;
  - filters (category tree, customizable, material, Arabic search, wildcard‑only queries);
  - hostile query parameters;
  - best‑selling and popular ordering, per‑customer order counts and spend (regression tests for correlated subqueries);
  - analytics revenue, delivery fees, and profit from cost snapshots, with profit hidden without permission;
  - settings validation (phone, `javascript:` URLs).

### E2E (`e2e`, Playwright + axe)

`globalSetup` reseeds local D1/R2 with known admin credentials and a known TOTP secret. **It wipes data: never point `E2E_BASE_URL` at production.**

- `commerce-flow.spec.ts` covers the brief's journey in order:
  - browse → customize (select with price delta, radio, text engraving, quantity) → live total → add to cart → header count;
  - cart → guest checkout (governorate, district, landmark) → COD → **double‑click place order** → confirmation with order number;
  - order tracking by number + phone (wrong phone rejected; no access without the token);
  - customer registers → checkout prefilled → order appears in the account → another customer's order 404s → sign out and back in;
  - **admin signs in with TOTP** → edits a price → the storefront shows the new price → an audit entry exists;
  - admin moves the order through production to out‑for‑delivery with a public note → **the guest sees the status and note**;
  - Operations admin is refused four Super‑Admin areas;
  - the language switch keeps the page and flips to RTL (`dir`, `lang`, Arabic heading).
- `a11y.spec.ts`: axe (WCAG 2.0/2.1/2.2 A and AA rule sets). Fails on any serious or critical violation. It covers 13 public pages in both locales, 10 admin pages (light theme), and 6 signed‑in customer pages in Arabic.
- `responsive.spec.ts`: 7 pages × widths 375/390/768/1024/1440 × both locales. It fails on horizontal page overflow and saves full‑page screenshots to `e2e/.artifacts/` for review.

## What automated tests do not cover

The following are listed as NOT TESTED or partially tested in `FINAL_AUDIT.md`:
- screen‑reader sessions with NVDA, VoiceOver, or TalkBack;
- real iOS/Android devices;
- Firefox and Safari (only Chromium is automated);
- performance on Cloudflare's edge (Lighthouse was only run locally);
- load and concurrency beyond the parallel‑request tests;
- behaviour with production Cloudflare Image Transformations enabled.
