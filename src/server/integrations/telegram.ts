import { redact, withTimeout, type FetchLike } from "./http";

// Telegram Bot API sendMessage. Plain text only (no parse_mode), so order data
// can never inject markup or links into the message.

export type TelegramConfig = { token: string; chatIds: string[] };

export type TelegramResult = { ok: true } | { ok: false; retryable: boolean; detail: string };

/** Parses "123, -100456" into chat ids; ignores anything that is not a Telegram id. */
export function parseChatIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /^-?\d{3,20}$/.test(s)))];
}

/** Like parseChatIds, but also returns the entries that were ignored (so misconfiguration is visible). */
export function parseChatIdsStrict(raw: string | undefined): { ids: string[]; invalid: number } {
  const parts = (raw ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const ids = parseChatIds(raw);
  return { ids, invalid: parts.filter((s) => !/^-?\d{3,20}$/.test(s)).length };
}

export async function sendTelegramMessage(token: string, chatId: string, text: string, fetchImpl: FetchLike = fetch): Promise<TelegramResult> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: withTimeout(5_000),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { description?: string };
    // 4xx (bad chat id, bot blocked) will not fix itself; 429/5xx may.
    const retryable = res.status === 429 || res.status >= 500;
    return { ok: false, retryable, detail: redact(`${res.status} ${body.description ?? ""}`, [token]) };
  } catch (error) {
    return { ok: false, retryable: true, detail: redact(`network ${String((error as Error)?.name ?? "error")}`, [token]) };
  }
}
