# WhatsApp OTP (Meta Cloud API): feasibility and setup

Status: **implemented behind the existing verification interface, not enabled.** Twilio Verify SMS remains the default and is not removed. Automated tests use mocks; no real WhatsApp message has been sent from this project.

## Current verification interface

`PhoneVerifier` (`src/server/integrations/twilio-verify.ts`):

- `start(phone, locale)` sends a code. Provider-checked channels (Twilio) return nothing to store. Self-generated channels (WhatsApp) return only `codeHash = HMAC-SHA256(APP_SECRET, "wa-otp:" + phone + ":" + code)`.
- `check(phone, code, { codeHash })` returns `approved`, `rejected` or `error`.

`src/server/services/phone-verification.ts` stores the channel and hash per challenge (`phone_verifications.channel`, `code_hash`; never the code). It keeps the 10-minute expiry, 5 attempts, 3 sends with a 60 s cooldown, per-number and per-IP rate limits, identical responses for registered and unknown numbers, and creates accounts only after approval. `src/server/sms.ts` picks the channel: WhatsApp first only if `PHONE_VERIFICATION_PRIMARY=whatsapp` and every WhatsApp variable is set, otherwise Twilio. When a WhatsApp code was sent and Twilio is configured, the verification screen offers **Send the code by SMS instead**, which replaces the code (the WhatsApp code stops working).

Why a fallback is needed: Meta's API returns 200 when it **accepts** a message, not when it is delivered. Delivery status arrives later via webhooks, which are not implemented. Customers without WhatsApp, with an old app, or offline will not get the code, and the app cannot know that at send time.

## What Meta requires (official documentation, checked 2026-10-10)

1. **Meta Business portfolio** (business.facebook.com) for RoboNest.3D, owned by an owner's account with 2FA.
2. **Meta developer app** (developers.facebook.com) of type Business, with the WhatsApp product added, linked to the portfolio.
3. **WhatsApp Business Account (WABA)** created through the app.
4. **A phone number** for the business that is **not** active on the regular WhatsApp or WhatsApp Business app (it becomes an API-only number; it can be an Iraqi number able to receive the SMS/voice registration code). Register it in WhatsApp Manager, set a 6-digit two-step PIN, and get its **Phone number ID**.
5. **Display name** approval (reviewed by Meta).
6. **Business verification** (official documents) is not required to start, but without it the portfolio is limited to messaging **250 unique customers per 24 hours** (reported by multiple providers; confirm in WhatsApp Manager). Verification raises the limit. For OTP volume, plan to verify.
7. **Payment method** on the WhatsApp account in Meta Business Settings (authentication templates are billed per delivered message).
8. **Authentication template** with a copy-code button ([Meta docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates)), approved in Arabic and English. Suggested: name `robonest_otp`, `add_security_recommendation: true`, `code_expiration_minutes: 10` (matches the app's 10-minute expiry), button text "Copy code" / "نسخ الرمز". Codes are max 15 characters; ours are 6 digits.
9. **Permanent access token**: Business Settings → System users → add a system user (Admin) → assign the app and the WABA → generate a token with `whatsapp_business_messaging` (and `whatsapp_business_management`). Do not use the 24-hour temporary token in production.

## Environment variables

| Variable | Value |
|---|---|
| `PHONE_VERIFICATION_PRIMARY` | `whatsapp` to try WhatsApp first; unset = SMS |
| `WHATSAPP_ACCESS_TOKEN` | System-user token (secret) |
| `WHATSAPP_PHONE_NUMBER_ID` | The phone number **ID** from WhatsApp Manager |
| `WHATSAPP_GRAPH_API_VERSION` | The Graph API version shown in your app dashboard, e.g. `v23.0` (no default is guessed) |
| `WHATSAPP_OTP_TEMPLATE_NAME` | Approved template name |
| `WHATSAPP_OTP_TEMPLATE_LANGUAGE_AR` / `_EN` | Exact approved language codes, e.g. `ar`, `en_US` |

Not needed for sending: WABA ID, app secret and webhook verify token (only for a future delivery-status webhook).

## Cost

Meta bills **per delivered template message** ([pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)). From **October 1, 2026**, Iraq moves out of "Rest of Middle East" to its own rates. Meta's page describes Iraq's change as "higher utility and authentication rates"; a third-party summary ([YCloud](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026)) lists $0.0079 for Iraq. These disagree in direction, so **confirm the authentication rate for Iraq in Meta's official rate card / WhatsApp Manager before relying on it.** The higher "authentication-international" rate applies only to nine listed countries (Iraq is not one) and only for businesses based in another country ([Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/authentication-international-rates)). Twilio SMS to Iraq has its own per-message price in the Twilio console.

## Feasibility verdict

- **Onboarding an Iraqi business directly with Meta: feasible.** Nothing found blocks a business based in Iraq from creating a portfolio, a WABA and an API number. Business verification documents are the main effort.
- **Reliability on Asiacell, Korek and Zain Iraq: not established.** WhatsApp delivery depends on the customer having WhatsApp and internet access, not on SMS routing, but we have **no test results or provider evidence** for these networks. Do not claim coverage until tested.
- **Recommendation:** keep Twilio SMS as the default and fallback. Pilot WhatsApp with staff phones on all three networks (Wi-Fi and mobile data, Arabic and English templates), then switch `PHONE_VERIFICATION_PRIMARY=whatsapp` only if the pilot succeeds. Add the delivery-status webhook before relying on WhatsApp alone.

## Manual confirmation still needed

Business verification outcome; display-name and template approval; the Iraq authentication rate in Meta's rate card; messaging limit shown in WhatsApp Manager; delivery tests on Asiacell, Korek and Zain; whether Twilio sender registration for Iraq is completed (fallback quality).
