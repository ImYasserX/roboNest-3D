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

/**
 * Optional server-only variable. Reads the Worker binding (wrangler secrets,
 * wrangler.jsonc vars, .dev.vars). Only under `next dev` does it also fall
 * back to process.env (`.env.local`). Built Workers never use process.env for
 * these: OpenNext copies .env files into the bundle, and a built Worker (E2E,
 * staging, production) must only use its real bindings.
 * Never import this from client code; values must not reach the browser.
 */
export async function getServerVar(name: ServerVarName): Promise<string | undefined> {
  const env = (await getEnv()) as unknown as Record<string, unknown>;
  const fromBinding = env[name];
  const fallback = process.env.NODE_ENV === "development" ? process.env[name] : undefined;
  const value = typeof fromBinding === "string" && fromBinding ? fromBinding : fallback;
  return value?.trim() || undefined;
}

export type ServerVarName =
  | "RESEND_API_KEY"
  | "CONTACT_FORM_EMAIL"
  | "CONTACT_FROM_EMAIL"
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_CHAT_IDS"
  | "TELEGRAM_CHAT_ID"
  | "TWILIO_ACCOUNT_SID"
  | "TWILIO_AUTH_TOKEN"
  | "TWILIO_VERIFY_SERVICE_SID"
  | "PHONE_VERIFICATION_PRIMARY"
  | "WHATSAPP_ACCESS_TOKEN"
  | "WHATSAPP_PHONE_NUMBER_ID"
  | "WHATSAPP_GRAPH_API_VERSION"
  | "WHATSAPP_OTP_TEMPLATE_NAME"
  | "WHATSAPP_OTP_TEMPLATE_LANGUAGE_AR"
  | "WHATSAPP_OTP_TEMPLATE_LANGUAGE_EN"
  | "FIB_ONLINE_DEPOSITS"
  | "FIB_BASE_URL"
  | "FIB_CLIENT_ID"
  | "FIB_CLIENT_SECRET";

const reportedMissing = new Set<string>();

/** Logs missing configuration once per isolate, by variable NAME only. */
export function reportMissingConfig(feature: string, names: string[]) {
  const key = `${feature}:${names.join(",")}`;
  if (reportedMissing.has(key)) return;
  reportedMissing.add(key);
  console.error(`[config] ${feature} is disabled: missing ${names.join(", ")}`);
}
