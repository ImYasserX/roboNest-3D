import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { createDb, type Database } from "@/server/db/client";
import { setTestEnv } from "@/server/env";

export type TestPlatform = { env: CloudflareEnv; db: Database; dispose: () => Promise<void> };

/** Boots in-memory D1 + R2 (Miniflare, same engine as production) and applies all migrations. */
export async function startPlatform(): Promise<TestPlatform> {
  const proxy = await getPlatformProxy<CloudflareEnv>({ configPath: "wrangler.jsonc", persist: false });
  // getPlatformProxy loads .dev.vars, which may hold REAL provider tokens.
  // Tests must never see them: remove every provider credential and turn on
  // the outbound kill switch. Tests pass fakes explicitly where needed.
  const loaded = { ...proxy.env } as Record<string, unknown>;
  for (const key of Object.keys(loaded)) if (/^(RESEND|TELEGRAM|TWILIO|WHATSAPP|FIB|CONTACT_FROM)_/.test(key)) delete loaded[key];
  const env = { ...loaded, OUTBOUND_INTEGRATIONS: "disabled", APP_SECRET: "test-app-secret-at-least-32-characters-long", SITE_URL: "http://localhost:3000" } as unknown as CloudflareEnv;
  const dir = path.resolve("drizzle/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sqlText = readFileSync(path.join(dir, file), "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      if (statement.trim()) await env.DB.prepare(statement).run();
    }
  }
  setTestEnv(env);
  return {
    env,
    db: createDb(env.DB),
    dispose: async () => {
      setTestEnv(undefined);
      await proxy.dispose();
    },
  };
}
