import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Env = CloudflareEnv;

const TEST_ENV_KEY = Symbol.for("robonest.testEnv");
type GlobalWithTestEnv = typeof globalThis & { [TEST_ENV_KEY]?: Env };

/** Test-only: inject bindings from wrangler's getPlatformProxy. */
export function setTestEnv(env: Env | undefined) {
  (globalThis as GlobalWithTestEnv)[TEST_ENV_KEY] = env;
}

export async function getEnv(): Promise<Env> {
  const override = (globalThis as GlobalWithTestEnv)[TEST_ENV_KEY];
  if (override) return override;
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

export async function getAppSecret(): Promise<string> {
  const secret = (await getEnv()).APP_SECRET;
  if (!secret || secret.length < 32) {
    // Fail closed: without the secret, TOTP secrets cannot be protected.
    throw new Error("APP_SECRET is missing or shorter than 32 characters");
  }
  return secret;
}

export async function getSiteUrl(): Promise<string> {
  const fromEnv = (await getEnv()).SITE_URL ?? process.env.SITE_URL;
  return (fromEnv || "http://localhost:3000").replace(/\/+$/, "");
}

export const isProduction = process.env.NODE_ENV === "production";
