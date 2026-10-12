# Payments and deposits (manual WhatsApp verification)

Since 2026-10-12 every payment is arranged directly with RoboNest.3D on WhatsApp (**0751-891-1112**, `https://wa.me/9647518911112`) and counts as received **only after an Owner confirms it** in admin → Payments. There is no automatic online payment.

## Rules (code: `src/lib/payment-rules.ts`, `src/lib/payment-due.ts`; database: migrations 0002 and 0005)

| Rule | Value |
|---|---|
| Delivery fee | Flat 5,000 IQD for every supported location |
| Deposit base | Products subtotal **after discounts**, **excluding** delivery |
| Threshold | A deposit is required when the base is **strictly greater than** 50,000 IQD (exactly 50,000 needs none) |
| Deposit | **30% of the base, rounded down** (`floor(base × 30 / 100)`) |
| Balance | Order total minus the verified deposit |

Examples: base 50,000 → no deposit. 50,001 → 15,000. 60,000 → 18,000. 74,000 + 5,000 delivery → deposit 22,200, balance 56,800.

## What a customer sees

After checkout the order page shows a **payment step**: order reference, the amount due now, the purpose (upfront deposit, full payment or remaining balance) and **Confirm payment on WhatsApp**. The button opens `https://wa.me/9647518911112?text=…` with a URL-encoded message that contains only the order number and amount, for example *"Hello RoboNest.3D, I would like to confirm payment for order RN-261012-ABC123. Amount: 20,000 IQD."* No name, phone, link token or other data. Opening WhatsApp changes nothing; the page states that payment counts only after the team has verified it, and keeps the instructions available (plus the phone number) if WhatsApp is unavailable. Optional transfer details (FIB / QiCard / ZainCash accounts) configured in admin → Payments are shown under the button.

What is due is derived only from the order row (`paymentDue`):
1. A required deposit not yet verified → **deposit**, paid upfront via WhatsApp.
2. Otherwise, while payment is pending or disputed → the **outstanding amount** (total minus a verified deposit). Orders with digital files pay it upfront via WhatsApp; physical-only orders usually pay it in cash on delivery (they can also pay in advance via WhatsApp).
3. Paid, refunded, cancelled or returned orders owe nothing.

## What an Owner does (admin → Payments, or the order page → Payment)

| Action | Allowed when | Effect |
|---|---|---|
| **Confirm payment** | the order is waiting for that payment | Dialog shows reference, exact amount and purpose and warns to check the money itself. The Owner re-types the amount (must equal the amount due), picks how it was paid, notes what they checked, and ticks "I checked that this money actually arrived". Deposit → `DEPOSIT_VERIFIED` (fulfilment may start; the order is **not** paid). Full/balance → payment `PAID` (downloads unlock). |
| **Not received** (deposit) / **Mark disputed** (full) | the payment is due | Reason required (internal); optional message to the customer. Deposit stays awaited; full payment becomes `DISPUTED`. Nothing is deleted, nothing is released. A disputed payment can still be confirmed later. |
| **Record refund** | payment `PAID`, or a verified deposit on a cancelled order | Only for money **already returned outside the website**. Type `REFUNDED` to confirm. Full: `PAID → REFUNDED` (downloads lock again). Nothing is moved or claimed automatically. |

The queue has tabs: awaiting verification, disputed, verification history (who, when, amount, how, note) and refunded; filters for deposits vs full payments. Customers appear only as first name and the last 3 phone digits.

**Who:** only **Owners** (`payments.verify`). Super Admins can view the queue but not decide (owner decision left open, so it stays off: `SUPER_ADMIN_MAY_VERIFY_PAYMENTS` in `src/lib/permissions.ts`). Operations staff cannot see payments. Marking an order DELIVERED no longer marks it paid: cash collected on delivery is confirmed by an Owner like any other payment.

## Safeguards (server and database)

- Every decision is an append-only `payment_verifications` row (migration 0005) plus an audit entry, written in the same D1 batch (one transaction) as the order change.
- Triggers refuse: `payment_status = 'PAID'` or `deposit_status = 'VERIFIED'` without a matching CONFIRMED row; any order inserted as PAID; a confirmation for a wrong amount (recomputed from the order row in SQL); a confirmation for an order that is not waiting for that payment (cancelled, already paid, deposit not yet verified); a second CONFIRMED row for the same order and kind (unique index), so concurrent clicks by two Owners cannot double-confirm; refunds of unpaid orders; any UPDATE of a ledger row.
- Request bodies only say which order and kind; amounts, currency (`IQD`) and state come from the database.
- Downloads require payment `PAID` (`services/downloads.ts`); a verified deposit, a dispute, a refund or an open payment never unlocks them.

## Retired (2026-10-12)

- **FIB online deposits:** the adapter (`server/integrations/fib.ts`), `services/online-deposits.ts`, the customer "Pay with FIB / I have paid" buttons and their actions were removed (recoverable from git history). `/api/payments/fib/callback` now answers `410 Gone`, reads nothing and changes nothing; the middleware's same-origin exemption for it was removed. `FIB_*` variables are ignored. Existing `deposit_payments` rows are kept as history.
- **Customer transfer-reference form** (`DEPOSIT_SUBMITTED`): removed. Orders already in `DEPOSIT_SUBMITTED` keep the reference (shown to the Owner) and are confirmed or rejected like any deposit.
- **Owner approval of the "manual fallback"**: no longer gates anything (manual is now the only method); the stored approval is kept in settings as history.
- **Free payment-status dropdown** on the order page (it allowed `orders.update`, i.e. Operations, to set PAID): removed.

**Legacy records:** nothing was rewritten. Orders that were already PAID or had a VERIFIED deposit before migration 0005 stay as they are (the gates only apply to new changes). Pending legacy payments are **not** marked paid; they appear in the queue and must be confirmed by an Owner.

## Re-enabling an automatic provider later

Do not just restore the old files. A provider must (1) create payments only for amounts from the order row, (2) verify status through the provider's authenticated API, never a callback body or redirect, and (3) record its decision as a `payment_verifications` row so the triggers above still apply. That needs an owner decision, merchant credentials and a sandbox test.
