# Deposits and payments

## Rules (code: `src/lib/payment-rules.ts`, database: migration 0002 triggers)

| Rule | Value |
|---|---|
| Delivery fee | Flat 5,000 IQD for every supported location |
| Deposit base | Products subtotal **after discounts**, **excluding** delivery |
| Threshold | A deposit is required when the base is **strictly greater than** 50,000 IQD (exactly 50,000 needs none) |
| Deposit | **30% of the base, rounded down** to whole IQD (`floor(base × 30 / 100)`, the same "round down" convention as percentage discounts) |
| Balance | Order total minus deposit, cash on delivery |

Examples: base 50,000 → no deposit. 50,001 → 15,000. 60,000 → 18,000. 60,000 with a 10,000 discount → base 50,000 → no deposit. 74,000 + 5,000 delivery → deposit 22,200, balance 56,800.

Enforcement points:
- **Checkout and quote acceptance** compute the deposit on the server; the browser preview uses the same function but is never trusted.
- **Order creation**: trigger `orders_deposit_rule_insert` rejects any order row whose `deposit_required`/`deposit_amount` do not match the rule; `orders_deposit_rule_update` forbids changing them later.
- **Payment**: online payments request exactly `orders.deposit_amount`; provider-reported amounts must match exactly in IQD.
- **Admin verification** (manual): the admin must type the amount received, which must equal the required deposit; `orders_deposit_gate` blocks fulfilment statuses until the deposit is VERIFIED.
- If no way to pay a deposit exists (no online provider and no owner-approved manual fallback with a method), orders above the threshold are refused.

## Provider status (researched 2026-10-10)

| Provider | Official API | Built here | What is needed |
|---|---|---|---|
| **FIB** (First Iraqi Bank) | Yes: [Web Payments](https://fib.iq/integrations/web-payments/), OAuth2 client credentials, create payment, status endpoint, status callback; sandbox `https://fib.stage.fib.iq`; official SDKs on [GitHub](https://github.com/First-Iraqi-Bank) | **Adapter built per the public docs, disabled.** Not verified with a real transaction. | FIB business account, the FIB Integration Request Form, sandbox `client_id`/`client_secret`, then production credentials and production base URL from FIB |
| **ZainCash** | Yes: [docs.zaincash.iq](https://docs.zaincash.iq/) (v2: OAuth2, webhooks, refunds) | No | ZainCash merchant account and credentials (client id/secret, API key) |
| **QiCard** | Yes: [developers-gate.qi.iq](https://developers-gate.qi.iq/) (REST API, webhooks) | No | QiCard merchant account and gateway credentials |

Nothing in this codebase marks a deposit paid from a customer's claim, a reference, a screenshot, a redirect or a callback body.

## FIB online deposits (how the adapter works)

1. Customer presses **Pay with FIB** on the order page. The server creates (or, on double clicks, reuses) one FIB payment for exactly the deposit, and shows FIB's payment code, app link and QR code.
2. FIB calls `POST /api/payments/fib/callback` with `{ id, status }`. The body is **not trusted**: the server only uses `id` to look up a payment it created, then asks FIB's authenticated status endpoint. The route always answers `200 {ok:true}`, so it cannot be used to probe payments. It is the only POST route exempt from the same-origin check.
3. Only a status of `PAID` with the exact amount in `IQD` verifies the deposit (`DEPOSIT_VERIFIED`, history actor `FIB`, audit `order.deposit.verified_online`, Telegram alert). Repeated callbacks are idempotent.
4. Edge cases are recorded for a manual decision, never auto-refunded: wrong amount/currency (`order.deposit.online_mismatch`), paid after the order was cancelled (`order.deposit.paid_after_close`), a second payment for an already verified order (`order.deposit.duplicate_payment`).
5. The customer's **I have paid, check now** button runs the same status check.

To enable (owners only, after approval):
1. Get **sandbox** credentials from FIB. Set `FIB_BASE_URL=https://fib.stage.fib.iq`, `FIB_CLIENT_ID`, `FIB_CLIENT_SECRET`, `FIB_ONLINE_DEPOSITS=enabled` in `.dev.vars` on a test machine.
2. The callback must reach the server over HTTPS: use a staging deployment (not production) or a tunnel to `wrangler dev`.
3. Place a test order above 50,000 IQD, pay it with FIB's sandbox app/tools, confirm: the order page shows "Deposit verified", admin shows method FIB and the payment id, the audit log has `order.deposit.verified_online`, the Telegram alert arrived. Also test an expired payment, a cancelled order and a repeated callback.
4. Only then request production credentials, set them as Worker secrets, and enable in production. Until a real transaction is verified, do not describe deposits as automated.

Refunds through FIB's API are not implemented. Any refund is arranged manually and must follow the published policy (deposit refund rules are still an owner decision).

## Manual transfer fallback (temporary)

Customers transfer the deposit themselves (FIB / QiCard / ZainCash, with the instructions configured in admin → Payments) and enter the transaction reference. Then an Owner or Super Admin opens the provider account, finds the transfer, types the amount received (must equal the deposit), and verifies; or marks "transfer not found".

The fallback works only while **an owner** has approved it in admin → Payments. Approval records the owner's name and date in the setting and the audit log (`payments.manualFallback.approved`). Super Admins cannot approve or withdraw it. Without approval, manual reports are refused and, unless FIB is enabled, high-value orders are blocked.
