import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    /** Public catalog media: raster images only (product photos, turntable frames). */
    MEDIA: R2Bucket;
    /** Private files: digital products and customer uploads. */
    PRIVATE_FILES: R2Bucket;
    /** Absolute public origin, e.g. https://robonest3d.tech once purchased; http://localhost:3000 locally (no trailing slash). */
    SITE_URL?: string;
    /** Server-only secret (>= 32 chars). Keys TOTP-secret encryption and IP hashing. */
    APP_SECRET?: string;
    // Optional server-only secrets (wrangler secret put …). See README.md#environment.
    RESEND_API_KEY?: string;
    CONTACT_FORM_EMAIL?: string;
    CONTACT_FROM_EMAIL?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_IDS?: string;
    TELEGRAM_CHAT_ID?: string;
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_VERIFY_SERVICE_SID?: string;
    PHONE_VERIFICATION_PRIMARY?: string;
    WHATSAPP_ACCESS_TOKEN?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
    WHATSAPP_GRAPH_API_VERSION?: string;
    WHATSAPP_OTP_TEMPLATE_NAME?: string;
    WHATSAPP_OTP_TEMPLATE_LANGUAGE_AR?: string;
    WHATSAPP_OTP_TEMPLATE_LANGUAGE_EN?: string;
    FIB_ONLINE_DEPOSITS?: string;
    FIB_BASE_URL?: string;
    FIB_CLIENT_ID?: string;
    FIB_CLIENT_SECRET?: string;
    /** "disabled" hides every provider credential (E2E, tests, quiet local work). */
    OUTBOUND_INTEGRATIONS?: string;
  }
}

export {};
