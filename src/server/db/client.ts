import "server-only";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import type { D1Database } from "@cloudflare/workers-types";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Database = DrizzleD1Database<typeof schema>;

export function createDb(d1: D1Database): Database {
  return drizzle(d1, { schema });
}

let cached: { d1: D1Database; db: Database } | undefined;

/** Drizzle client bound to the request's D1 binding. */
export async function getDb(): Promise<Database> {
  const env = await getEnv();
  if (cached?.d1 !== env.DB) cached = { d1: env.DB, db: createDb(env.DB) };
  return cached.db;
}

/**
 * Runs statements atomically. D1 has no interactive transactions; a batch is
 * executed as a single implicit transaction and rolls back entirely if any
 * statement fails (including CHECK/UNIQUE constraint violations).
 */
export type BatchStatement = BatchItem<"sqlite">;

export async function runBatch(db: Database, statements: BatchStatement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

export { schema };

/** D1 allows at most 100 bound parameters per statement; split long IN lists. */
export const D1_MAX_PARAMS = 100;

export function chunk<T>(items: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
