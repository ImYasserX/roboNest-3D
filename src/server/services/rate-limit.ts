import { lt, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { rateLimits } from "@/server/db/schema";

export type RateLimitRule = { limit: number; windowSeconds: number };

// Iraqi mobile carriers use carrier-grade NAT, so many real customers can
// share one IP. Customer-facing limits are therefore keyed on the visitor or
// account where possible, with looser per-IP ceilings as a backstop against
// cookie-cycling abuse. Credential-guessing limits stay strict per target.
// Fixed-window counters stored in D1. D1 is a single primary database, so the
// counters are consistent across all Worker isolates and locations, unlike an
// in-memory Map. Cost: one upsert per protected request.
export const RATE_LIMITS = {
  customerLogin: { limit: 40, windowSeconds: 15 * 60 },
  customerLoginPhone: { limit: 5, windowSeconds: 15 * 60 },
  register: { limit: 20, windowSeconds: 60 * 60 },
  passwordReset: { limit: 10, windowSeconds: 60 * 60 },
  passwordChange: { limit: 10, windowSeconds: 60 * 60 },
  adminLogin: { limit: 10, windowSeconds: 15 * 60 },
  adminTotp: { limit: 10, windowSeconds: 15 * 60 },
  checkout: { limit: 10, windowSeconds: 10 * 60 },
  checkoutIp: { limit: 100, windowSeconds: 10 * 60 },
  cartWrite: { limit: 120, windowSeconds: 10 * 60 },
  cartWriteIp: { limit: 1000, windowSeconds: 10 * 60 },
  upload: { limit: 20, windowSeconds: 60 * 60 },
  uploadIp: { limit: 150, windowSeconds: 60 * 60 },
  customRequest: { limit: 5, windowSeconds: 60 * 60 },
  customRequestIp: { limit: 40, windowSeconds: 60 * 60 },
  contact: { limit: 20, windowSeconds: 60 * 60 },
  orderLookup: { limit: 30, windowSeconds: 15 * 60 },
  download: { limit: 60, windowSeconds: 60 * 60 },
  quoteResponse: { limit: 30, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/**
 * Consumes one unit for (bucket, identifier). Returns false when the limit has
 * been exceeded for the current window.
 */
export async function consumeRateLimit(
  db: Database,
  bucket: RateLimitBucket,
  identifier: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const rule = RATE_LIMITS[bucket];
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const key = `${bucket}:${identifier}:${windowStart}`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, expiresAt: windowStart + windowMs })
    .onConflictDoUpdate({ target: rateLimits.key, set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });

  // Opportunistic cleanup of expired windows (~1% of calls).
  if (Math.random() < 0.01) {
    await db.delete(rateLimits).where(lt(rateLimits.expiresAt, nowMs));
  }
  return (row?.count ?? 1) <= rule.limit;
}

/** Consumes the per-actor bucket and the per-IP backstop; both must allow. */
export async function consumeScoped(db: Database, bucket: RateLimitBucket, ipBucket: RateLimitBucket, actorKey: string | null, ipHash: string) {
  const ipOk = await consumeRateLimit(db, ipBucket, ipHash);
  const actorOk = actorKey ? await consumeRateLimit(db, bucket, actorKey) : true;
  return ipOk && actorOk;
}

export async function resetRateLimit(db: Database, bucket: RateLimitBucket, identifier: string, nowMs = Date.now()) {
  const windowMs = RATE_LIMITS[bucket].windowSeconds * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  await db.delete(rateLimits).where(sql`${rateLimits.key} = ${`${bucket}:${identifier}:${windowStart}`}`);
}
