import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    /** Public catalog media (images, GLB previews). */
    MEDIA: R2Bucket;
    /** Private files: digital products and customer uploads. */
    PRIVATE_FILES: R2Bucket;
    /** Absolute public origin, e.g. https://3d.robonest.iq (no trailing slash). */
    SITE_URL?: string;
    /** Server-only secret (>= 32 chars). Keys TOTP-secret encryption and IP hashing. */
    APP_SECRET?: string;
  }
}

export {};
