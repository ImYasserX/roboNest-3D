// Shared helpers for the local Telegram scripts. The bot token is read from
// the environment, .dev.vars, or a hidden prompt, and is NEVER printed: it
// only appears inside request URLs, which are never logged.
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

export function devVar(name) {
  if (!existsSync(".dev.vars")) return undefined;
  const line = readFileSync(".dev.vars", "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^"|"$/g, "") || undefined;
}

/** True when the outbound kill switch is set (environment first, then .dev.vars). */
export function outboundDisabled() {
  return (process.env.OUTBOUND_INTEGRATIONS ?? devVar("OUTBOUND_INTEGRATIONS")) === "disabled";
}

export async function promptHidden(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const write = rl._writeToOutput.bind(rl);
  let muted = false;
  rl._writeToOutput = (s) => (!muted || s.includes("\n") ? write(s) : undefined);
  process.stdout.write(question);
  muted = true;
  const value = await new Promise((resolve) => rl.once("line", resolve));
  muted = false;
  rl.close();
  process.stdout.write("\n");
  return String(value).trim();
}

export async function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN || devVar("TELEGRAM_BOT_TOKEN") || (await promptHidden("Bot token (input hidden): "));
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    console.error("That does not look like a bot token (expected 123456:ABC...). Nothing was sent.");
    process.exit(1);
  }
  return token;
}

/** Calls a Bot API method. Errors contain Telegram's description only, never the URL or token. */
export function botApi(token) {
  return async (method, body) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res) return { ok: false, description: "network error or timeout" };
    const json = await res.json().catch(() => ({}));
    return json.ok ? { ok: true, result: json.result } : { ok: false, status: res.status, description: `${res.status} ${json.description ?? ""}`.trim() };
  };
}

/** Same rules as the app (src/server/integrations/telegram.ts parseChatIdsStrict). */
export function parseChatIds(raw) {
  const parts = String(raw ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const valid = [...new Set(parts.filter((s) => /^-?\d{3,20}$/.test(s)))];
  return { ids: valid, invalid: parts.filter((s) => !/^-?\d{3,20}$/.test(s)) };
}
