# Production preparation guide

This guide is sequential. Do every step in order and **stop** when a step says so. Nothing here has been done yet: no Cloudflare resources were created, no migration was applied remotely, nothing was deployed, and no DNS was changed.

**Local vs remote.** Wrangler commands act on your **local** simulator unless they include `--remote`. Local data lives in `.wrangler/state/` on your computer. Anything with `--remote`, `wrangler secret put`, `wrangler deploy`, or a change in the Cloudflare dashboard affects **production**.

**Domains.** RoboNest.3D's own domain (planned: `robonest3d.tech`) is not purchased yet and is not needed until step 12. `robonest.tech` belongs to the **separate electronics store**: never change its DNS, email forwarding or Resend records from this project. Using `contact@robonest.tech` (recipient) and `no-reply@robonest.tech` (sender) relies on the email setup that already exists on that domain; whether to keep that or move RoboNest.3D email to its own domain later is an owner decision.

**Local first.** Everything can be built and tested locally without any of these steps: [docs/LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

**Approval rule.** Steps marked **OWNER APPROVAL** are irreversible or affect real customers. Run them only after both owners agree, ideally with one person typing and the other reading along.

Never paste secret values into chats, tickets, screenshots or commit messages. `wrangler secret put` prompts for the value, so it does not end up in your shell history.

---

## 1. Confirm the Cloudflare account and Workers plan

- **Purpose:** everything must live in the business's own Cloudflare account, on a plan that can run password hashing (the Free plan's CPU limit is too low).
- **Do:** `npx wrangler login`, then `npx wrangler whoami`. In the dashboard: **Workers & Pages → Plans**.
- **Success:** `whoami` shows the business email and the RoboNest account name; the plan is **Workers Paid**.
- **Stop if:** it shows a personal or unknown account, or the Free plan. Log out (`npx wrangler logout`) and fix this first.

## 2. Find or create the production D1 database

- **Purpose:** `wrangler.jsonc` still has the placeholder `database_id` `00000000-0000-0000-0000-000000000000`.
- **Do:** `npx wrangler d1 list` (read-only). If a database named `robonest-3d` already exists, run `npx wrangler d1 info robonest-3d` and copy its UUID. If it does not exist: **OWNER APPROVAL** → `npx wrangler d1 create robonest-3d` (pick a location near Iraq if asked) and copy the printed `database_id`.
- **Then:** put the UUID in `wrangler.jsonc` → `d1_databases[0].database_id`.
- **Success:** `npx wrangler d1 info robonest-3d` shows the same UUID that is in `wrangler.jsonc`.
- **Stop if:** there are several similar databases and you are not sure which one is production. Do not guess; ask whoever created them.

## 3. Identify the R2 buckets and bindings

- **Purpose:** the Worker expects two **private** buckets: `MEDIA` → `robonest-3d-media` (catalog images), `PRIVATE_FILES` → `robonest-3d-private` (customer uploads and paid downloads).
- **Do:** `npx wrangler r2 bucket list`. If missing: **OWNER APPROVAL** → `npx wrangler r2 bucket create robonest-3d-media` and `npx wrangler r2 bucket create robonest-3d-private`. In the dashboard (**R2 → bucket → Settings**) confirm **Public access: Disabled** and **no r2.dev URL** for both.
- **Success:** both names appear, both private, names match `wrangler.jsonc` exactly.
- **Stop if:** either bucket is public. Customer files must never be publicly reachable.

## 4. Review the migrations before applying them

- **Purpose:** know exactly what will change.
- **Do:** `npx wrangler d1 migrations list robonest-3d --remote` (read-only) shows which migrations are pending. Read each file in `drizzle/migrations/`:
  - `0000_init.sql`: the original schema.
  - `0001_owners_deposits_notifications.sql`:
    - **Contact-message table rebuild:** creates `__new_contact_messages`, copies every row (email and delivery status set to NULL for old rows), drops the old table, renames the new one. No message content is changed. On an empty database it is harmless.
    - **Delivery-fee updates:** `UPDATE delivery_zones SET fee = 5000` and the same for `delivery_areas`. This overwrites any per-governorate fees. The app already ignores those columns (flat 5,000 IQD), so this only keeps exports consistent.
    - Adds deposit columns, phone verification, the notification outbox, and protective triggers for owners and deposits.
  - `0002_deposit_rate_online_whatsapp.sql`: online deposit payments table (now history only), WhatsApp code-hash columns, and triggers that enforce the 30% deposit rule.
  - `0003_turntable_previews_no_resin.sql`: turntable frames table (kept as history) and removal of a stored RESIN custom-print material.
  - `0004_preview_proxies.sql`: additive. `preview_models` table, fingerprint columns on `digital_files`, triggers that keep previews and paid files apart.
  - `0005_manual_payment_verification.sql`: additive. `payment_verifications` ledger and triggers: no PAID / VERIFIED without an Owner's recorded confirmation, exact amounts, one confirmation per order and kind, append-only. Existing paid or verified orders are not changed.
- **Success:** you understand every statement, and the pending list is exactly the files you reviewed.
- **Stop if:** the remote database already has orders or messages you did not expect. Take the backup in step 5 first and review again.

## 5. Back up and prove you can restore

- **Purpose:** be able to undo a mistake.
- **Do:**
  1. `npx wrangler d1 time-travel info robonest-3d` shows the current bookmark (D1 Time Travel keeps point-in-time history; check the retention for your plan in the dashboard). Save the bookmark text.
  2. `npx wrangler d1 export robonest-3d --remote --output=backup-$(date +%Y%m%d-%H%M).sql` makes a full SQL export (read-only for the database). Store it somewhere private (it may contain customer data), ideally outside the repository; `backup-*.sql` files are git-ignored as a safety net.
  3. Prove the export restores, **locally** into a throwaway folder: `npx wrangler d1 execute robonest-3d --local --persist-to ./restore-test --file=backup-….sql`, then `npx wrangler d1 execute robonest-3d --local --persist-to ./restore-test --command "SELECT COUNT(*) FROM orders"` and compare with the remote count. Delete `./restore-test` afterwards.
- **Success:** you have a saved bookmark, an export file, and a local restore whose counts match.
- **Stop if:** the export or the local restore fails. Do not migrate without a working backup.
- **If you ever need to roll back** (OWNER APPROVAL): `npx wrangler d1 time-travel restore robonest-3d --bookmark=<saved bookmark>`.

**Apply the migrations (OWNER APPROVAL):** `npx wrangler d1 migrations apply robonest-3d --remote`. Success: every file shows ✅. Stop and restore if any fails.

## 6. Review variables and secrets (names only)

- **Purpose:** make sure everything is set, without ever displaying values.
- **Do:** `npx wrangler secret list` shows **names only**. Compare with `.env.example`. In `wrangler.jsonc` → `vars`, set `SITE_URL` to the real https origin (no trailing slash) and keep `CONTACT_FORM_EMAIL` = `contact@robonest.tech`.
- **Required secrets:** `APP_SECRET` (generate with `openssl rand -base64 48`; store it in the owners' password manager; changing it later invalidates enrolled authenticators and order links). Then: `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Optional (only when ready): `WHATSAPP_*`. (`FIB_*` is retired and ignored.)
- **`OUTBOUND_INTEGRATIONS`:** must **not** be set in production (it would silently disable email, Telegram, SMS and payments). It **must** be `disabled` on any staging copy that the E2E suite runs against; the suite refuses to run otherwise.
- **Set each:** `npx wrangler secret put NAME` (prompts for the value). **OWNER APPROVAL** for production secrets.
- **Success:** `wrangler secret list` shows every required name; admin → Settings (after step 7) shows "Yes" for each integration.
- **Stop if:** a secret value was ever pasted into a chat, document or commit. Rotate it at the provider first.

## 7. Provision both owner accounts

- **Purpose:** create Yasser and Ayman as the only two owners, each with a password only they know.
- **Do (each owner, on their own computer):** `npm run owner:bootstrap -- yasser` (or `ayman`). Choose a username and a strong password (from a password manager). Then **OWNER APPROVAL** → `npx wrangler d1 execute robonest-3d --remote --file=.owner-yasser.sql` and immediately `rm .owner-yasser.sql`.
- **Verify:** `npx wrangler d1 execute robonest-3d --remote --command "SELECT username, display_name, role, status, totp_enabled FROM admin_users WHERE role = 'OWNER'"`.
- **Success:** exactly two rows, "Yasser" and "Ayman", role OWNER, status ACTIVE. At first sign-in (after deployment) each owner must enroll an authenticator app before any admin page opens.
- **Stop if:** a third row appears (the database trigger should prevent it) or a display name is wrong. Do not continue; investigate.

## 8. Configure Resend and test real delivery

- **Purpose:** contact-form messages must reach `contact@robonest.tech`, sent from a separate, verified sender.
- **Variables:** `CONTACT_FORM_EMAIL` = `contact@robonest.tech` (already in `wrangler.jsonc` vars, not a secret). `CONTACT_FROM_EMAIL` = a **different** address on the verified domain, e.g. `RoboNest.3D <no-reply@robonest.tech>`; the app refuses to send when sender and recipient are the same. `RESEND_API_KEY` = secret.
- **Domain (Resend dashboard → Domains → robonest.tech):** status must be **Verified**. The Resend DNS records on `robonest.tech` (DKIM `resend._domainkey`, SPF and MX on `send.`) already exist and are shared with the electronics store: **do not change them from this project**. `npm run email:check` confirms them via public DNS. If RoboNest.3D later sends from `robonest3d.tech`, that domain must be added and verified in Resend (DNS change, **OWNER APPROVAL**).
- **Receiving:** `contact@robonest.tech` is received through **Porkbun email forwarding** (MX `fwd1/fwd2.porkbun.com`). In Porkbun → Email Forwarding, confirm a forward for `contact@` exists and points to an inbox an owner reads. DNS cannot show this.
- **Local:** keep `RESEND_API_KEY` and `CONTACT_FROM_EMAIL` in `.dev.vars` (not `.env.local`; `.env*` values are copied into build bundles and `npm run cf:build` refuses them).
- **Production secrets (OWNER APPROVAL):** `npx wrangler secret put RESEND_API_KEY` and `npx wrangler secret put CONTACT_FROM_EMAIL`.
- **Check (sends nothing):** `npm run email:check`. It reports variables (names and addresses only, the key is hidden), the public DNS records, and Resend's domain status if the key is allowed to read it (a "Sending access" key cannot; then read the status in the dashboard).
- **One controlled test (OWNER APPROVAL, sends one real email):** `npm run email:test -- --to <an inbox you control>` and type `SEND` at the prompt. It prints Resend's email id when accepted. To test the real contact inbox, use `--to contact@robonest.tech`.
- **After deployment:** admin → Settings → **Send test email** (goes to `contact@robonest.tech`), then submit the public contact form once with an address you control.
- **Success:** Resend accepts (email id shown), the message arrives (check spam), replies go to the visitor's address, and admin → Messages shows "Emailed to the team". Resend dashboard → Emails shows the message as **Delivered**.
- **Stop if:** `email:check` reports a problem, the domain is not Verified, the Porkbun forward for `contact@` is missing, or the test is not delivered.

## 9. Configure Telegram and test both owners

- **Do:** follow README → Telegram order alerts (BotFather, both owners press Start, `node scripts/telegram-chat-ids.mjs`, set both secrets).
- **Test before deploying (no data touched):** `npm run telegram:check` (verifies token and both chats, sends nothing), then `npm run telegram:test` (sends a "NOT an order" message to each owner).
- **Test after deploying:** admin → Notifications → **Send test message** (uses the Worker's secrets; writes only a TEST notification row and an audit entry).
- **Success:** the page shows 2 recipients and "Delivered to every configured chat"; **both** owners confirm the message on their phones.
- **Stop if:** one owner did not receive it. Read the hint next to the error, fix, and retry.

## 10. Configure and test phone verification

- **Do:** Twilio console → **Verify → Services → Create**, enable **SMS**, copy the Service SID. Register an alphanumeric sender for Iraq if Twilio offers it (Asiacell requires registration from July 2026). Set the three `TWILIO_*` secrets.
- **Test** with real numbers on **Asiacell, Korek and Zain**: register, receive the SMS, verify; sign out and in; "Forgot password" with SMS; try a wrong code 5 times (must lock); register an existing number (must not reveal or change anything).
- **Success:** codes arrive on all three networks within a minute; accounts appear only after verification.
- **Stop if:** codes do not arrive on any network. Registration stays disabled until fixed; do not enable a workaround that skips verification.
- WhatsApp is optional and not enabled; see `docs/WHATSAPP_OTP.md`.

## 11. Test checkout, deposits, cancellation and refunds

Use a **staging** copy (a second Worker and database, not production) or production **before** announcing the site, with test products.

- **Standard order** (below 50,000 IQD): delivery 5,000 IQD; status Received; Telegram alert to both owners.
- **Exactly 50,000 IQD** products total: no deposit.
- **High-value order** (e.g. 74,000): checkout shows deposit 22,200 (30%) and balance 56,800 (delivery included in the balance, not in the 30%).
  - The order page shows the deposit, purpose and a **Confirm payment on WhatsApp** button (`https://wa.me/9647518911112?text=…` with only the order number and amount). Opening it changes nothing.
  - An **Owner** (admin → Payments) confirms the deposit only after seeing the money; a Super Admin sees the queue but cannot confirm. Then confirm the balance after delivery and check a digital order's downloads unlock only after its full payment is confirmed.
  - **Manual fallback**: an owner approves it in admin → Payments, enables a method and writes the transfer instructions. Customer transfers and enters the reference. Admin checks the real provider account, types 22200, verifies. Confirm the order. Check the audit log entries.
- **Cancellation:** cancel an order awaiting a deposit; cancel a confirmed order; check stock and discount are restored.
- **Refunds:** there is no refund API. Agree the deposit refund rules first (open owner decision), return money outside the website, then record it with **Record refund** (admin → order → Payment), which writes the ledger and the audit log.
- **Success:** every result above matches; nothing is marked paid without a verified check.
- **Stop if:** any order can be confirmed without a verified deposit, or any amount differs from the rules.

## 11b. Interactive 3D previews (reduced proxies only)

- **Purpose:** the 3D viewer must show an approved, reduced preview proxy, never a paid file.
- **Do:** in admin → product → 3D preview, choose a paid STL/OBJ/GLB (up to 25 MB) and a detail level, press "Generate preview", open "Review in 3D", then an Owner or Super Admin presses "Approve and publish". For larger originals, or products without a paid file, run `npm run preview:proxy -- model.stl` on an owner's computer and upload the resulting `.preview.glb` with "Upload a proxy GLB". Legacy GLBs: press "Check legacy GLB"; it only reports. Nothing is published without approval.
- **Check:** on the product page, press "3D view" then "Load 3D preview" with the browser's Network tab open: exactly one `model/gltf-binary` response, from `/api/previews/<id>`, well under 1 MB; nothing from `/media/…glb`, `digital/` or any third-party domain; no CSP errors in the console. Withdraw the preview and confirm the same URL returns 404.
- **Stop if:** a model response is larger than a few MB, comes from anywhere other than `/api/previews/`, or a paid file's download works without a purchase.

## 12. Final smoke test before public launch

**OWNER APPROVAL** for deployment: on a machine whose `.env*` files contain **no** secrets, run `npm run cf:build` (it must finish with "Bundle check: no secrets from .env files"; never use `CF_BUILD_ALLOW_ENV_SECRETS` for a deploy build), then `npx opennextjs-cloudflare deploy`. Keep the site private (Cloudflare Access on the whole domain, or an unannounced workers.dev URL) until this step passes.

- Visit `/ar` and `/en` on desktop and on Android/iOS phones: header, menu side (Arabic opens from the right), light/dark theme, search, categories, product pages.
- Run steps 8 to 11 once more on the deployed site. Run the E2E suite **only** against a staging copy (`E2E_BASE_URL=…`; it wipes data, never against production).
- Check response headers (CSP, HSTS) with your browser's network tab; confirm `/admin` redirects to login and `/media/…` cannot reach private files.
- **Success:** everything passes, both owners have signed in with TOTP, and real Resend, Telegram and SMS deliveries were confirmed.
- **Stop if:** any real integration is unverified. Do not announce the site or attach the public domain until it is.

Only after all twelve steps succeed: attach the custom domain (**OWNER APPROVAL**, DNS change) and remove the access restriction.
