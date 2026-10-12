# Local development and smoke test (no domain needed)

Everything runs on your computer with Wrangler's local simulators. No Cloudflare account, domain, Worker, remote database or bucket is needed or touched. `robonest3d.tech` does not need to exist yet, and the separate electronics store at `robonest.tech` is never modified by anything here.

## Where things live locally

| What | Where | Notes |
|---|---|---|
| D1 database | `.wrangler/state/v3/d1` | Created by `npm run setup` / `npm run db:migrate:local` |
| E2E database and buckets | `.wrangler/e2e-state` | Separate copy, migrated and reseeded by every `npm run test:e2e` |
| R2 buckets `MEDIA`, `PRIVATE_FILES` | `.wrangler/state/v3/r2` | Simulated; private files are only served by authorization-checked routes |
| Secrets | `.dev.vars` | Read by `next dev` (through OpenNext's dev bindings), `wrangler dev`, Vitest and the seed. Git-ignored, mode 600 |
| Non-secret vars | `wrangler.jsonc` → `vars` | `SITE_URL`, `CONTACT_FORM_EMAIL` |
| `.env.local` | keep **empty of credentials** | OpenNext copies `.env*` values into build bundles; `npm run cf:build` fails if a secret is found there |

`.dev.vars` keys used today: `APP_SECRET`, `SITE_URL` (`http://localhost:3000`), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`, `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`. All names are listed in `.env.example`.

### The outbound kill switch

`OUTBOUND_INTEGRATIONS=disabled` hides every provider credential (Resend, Telegram, Twilio, WhatsApp, FIB) from the app, so nothing can be sent.

- **E2E** always sets it (`wrangler dev --var OUTBOUND_INTEGRATIONS:disabled` in `playwright.config.ts`), never reuses a server you started yourself, and a first "outbound-safety" step checks `/api/health` and stops the suite if the server could send for real.
- **Vitest** strips provider credentials loaded from `.dev.vars` and sets the switch.
- **Your own `npm run dev`** does NOT set it: with real tokens in `.dev.vars`, orders you place by hand will alert both owners on Telegram and the contact form will send real email. To work quietly, add `OUTBOUND_INTEGRATIONS=disabled` to `.dev.vars` (admin → Settings shows the current state).

## Commands

| Goal | Command | Remote? |
|---|---|---|
| First setup (creates `.dev.vars` with an `APP_SECRET`, applies migrations locally) | `npm install && npm run setup` | No |
| Sample data (wipes local data with `--reset`) | `npm run db:seed` / `npm run db:seed -- --reset` | No |
| Day-to-day development with hot reload, http://localhost:3000 | `npm run dev` | No |
| Production bundle locally, http://localhost:8787 | `npm run cf:build` then `npx wrangler dev --port 8787 --ip 127.0.0.1` | No |
| Same, via OpenNext | `npm run cf:preview` | No (only `--remote` would use remote resources) |
| Checks | `npm run typecheck`, `npm run lint`, `npm test` | No |
| E2E (uses its own `.wrangler/e2e-state`; your local data is not touched; builds must exist) | `npm run cf:build && npm run test:e2e` | No |
| 3D preview proxy from a model file | `npm run preview:proxy -- model.stl` | No |

Use `http://localhost:8787` (not `127.0.0.1`) for the production bundle: its cookies are `__Host-`/`Secure`, which browsers accept on `localhost` only.

**Commands that DO touch Cloudflare (do not run before approval):** anything with `--remote`, `wrangler d1 create`, `wrangler r2 bucket create`, `wrangler secret put`, `wrangler deploy`, `opennextjs-cloudflare deploy`, `opennextjs-cloudflare preview --remote`. No npm script runs any of them.

`SITE_URL` locally: `http://localhost:3000` (used for absolute links: canonical URLs, password-reset links, admin links in Telegram alerts). There are no OAuth or payment callbacks (payments are confirmed manually by an Owner, see `docs/PAYMENTS.md`).

## Repeatable local smoke test

Run in order. Steps 1 to 4 send nothing.

1. **Static checks and tests:** `npm run typecheck && npm run lint && npm test`. Expect all passing.
2. **Fresh database (throwaway, your data untouched):**
   ```bash
   D=$(mktemp -d)
   npx wrangler d1 migrations apply robonest-3d --local --persist-to "$D"
   SEED_PERSIST_TO="$D" npm run db:seed
   rm -rf "$D"
   ```
   Expect 0000 to 0004 ✅ and "Seed complete".
3. **Build and safety:** `npm run cf:build`. Must end with "Bundle check: no secrets from .env files in the Worker bundle."
4. **E2E:** `npm run test:e2e`. The first step must report outbound disabled; all tests pass. It migrates and reseeds `.wrangler/e2e-state` only; your normal local database is left as it is.
5. **Telegram (manual, real):** `npm run telegram:check` sends nothing and lists both owners. `npm run telegram:test` sends one "NOT an order" message to each owner. Never test alerts by placing real orders.
6. **Email (manual, real, only with explicit approval):** `npm run email:check` sends nothing. A real test is `npm run email:test -- --to <an inbox you control>`, typed `SEND` to confirm.
7. **Phone verification:** mocked in automated tests only. A real test needs Twilio credentials (`TWILIO_*`) and real phones on Asiacell, Korek and Zain; see `docs/PRODUCTION_SETUP.md` step 10.
8. **Payments:** deposit maths, manual confirmation, disputes, refunds, duplicate/concurrent confirmations, amount checks and download unlocking are covered by tests (`tests/integration/manual-payments.test.ts`). No real payment happens: confirming in the admin only records what an Owner checked.
9. **By hand in the browser** (`npm run dev`, with `OUTBOUND_INTEGRATIONS=disabled` in `.dev.vars` if you do not want real alerts): Arabic and English, the menu side on a phone-sized window, light/dark theme, search, categories, cart (5,000 IQD delivery), a 60,000 IQD order (deposit 18,000), an exactly-50,000 order (no deposit), admin sign-in with the seeded accounts (passwords printed once by the seed).

## Admin and owner access (local)

**Roles** (`src/lib/permissions.ts`): **OWNER** has every permission and must use an authenticator app (TOTP); only another owner can reset an owner's password or TOTP; owners cannot be demoted, disabled or deleted (database triggers). **SUPER_ADMIN** has every permission except confirming payments (Owner-only `payments.verify`) and must use TOTP. **OPERATIONS** runs daily work (orders, products, customers, delivery, content) but cannot manage admins, settings, the audit log, discounts, payments, notifications or delete products; TOTP optional unless required in Settings.

**E2E test owner:** `npm run test:e2e` also creates `e2e-owner` (role OWNER, fixture password in `e2e/fixtures.ts`), but only in `.wrangler/e2e-state`; the seed refuses to create it in your normal local database.

**Development accounts** (created by `npm run db:seed`, never in production): `dev-super` (Super Admin) and `dev-ops` (Operations). The seed prints random passwords once. `npm run test:e2e` creates its own copies with the fixture passwords and TOTP secret in `e2e/fixtures.ts` (public in the repository), but only in `.wrangler/e2e-state`, not in your normal local database.

**Sign in:** open http://localhost:3000/en/admin (or `/ar/admin`), enter the username and password, then the 6-digit code from your authenticator app. A Super Admin or Owner without TOTP is sent to enrollment first: scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) and enter a code.

**Real owners (Yasser, Ayman).** Each owner creates their own local account, in their own terminal (the password is typed hidden, twice; only a PBKDF2 hash is written, to a temporary mode-600 file that the script applies to the LOCAL database and deletes):
```bash
npm run owner:bootstrap -- yasser --local        # Ayman: npm run owner:bootstrap -- ayman --local
npx wrangler d1 execute robonest-3d --local --command "SELECT username, display_name, role, status, totp_enabled FROM admin_users WHERE role = 'OWNER'"
```
The script stops without changing anything if the username or that owner already exists, or if two owners exist. It never connects to Cloudflare in `--local` mode.
Owners created locally can never be deleted from that local database (owner protection triggers, which `db:seed --reset` respects). If you need a clean slate, delete the local state folder `.wrangler/state` and run `npm run setup` again.

**Forgot a password or lost the authenticator (local):**
```bash
npm run admin:reset -- <username>                 # new password only
npm run admin:reset -- <username> --reset-totp    # also forces TOTP re-enrollment
npx wrangler d1 execute robonest-3d --local --file=.admin-reset.sql
rm .admin-reset.sql
```
This works for owners too (it changes only the password/TOTP and signs out sessions; roles cannot be changed). In production, an owner resets the other owner from admin → Admin users; applying a reset file with `--remote` is an emergency step that needs owner approval.

## 3D previews (local)

Interactive previews are reduced **proxies**, never the paid files (see SECURITY.md, "3D model protection"). In admin → product → 3D preview: generate one from a paid STL/OBJ/GLB (or upload a proxy made with `npm run preview:proxy -- model.stl`), open "Review in 3D", then approve it as `dev-super` (Operations cannot approve). Until a product has an approved proxy, its page shows photos only.

Your local database from before migration 0004 has no proxies, so its products show no 3D viewer until you generate and approve them. Its old turntable frames are kept but no longer shown. `npm run db:seed -- --reset` (which wipes local data) would create approved sample proxies instead.
