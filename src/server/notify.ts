import "server-only";
import { after } from "next/server";
import { getDb } from "@/server/db/client";
import { getServerVar, getSiteUrl, outboundIntegrationsDisabled, reportMissingConfig } from "@/server/env";
import { parseChatIdsStrict } from "@/server/integrations/telegram";
import { dispatchPending, suppressNotifications, type NotifierConfig } from "@/server/services/notifications";

/** Telegram settings from server secrets; null (and a log line naming the variables) when incomplete. */
export async function getNotifierConfig(): Promise<NotifierConfig | null> {
  const [token, list, single, siteUrl] = await Promise.all([
    getServerVar("TELEGRAM_BOT_TOKEN"),
    getServerVar("TELEGRAM_CHAT_IDS"),
    getServerVar("TELEGRAM_CHAT_ID"),
    getSiteUrl(),
  ]);
  const { ids: chatIds, invalid } = parseChatIdsStrict(list ?? single);
  // Never silently drop an owner: name the problem (not the values) in the logs.
  if (invalid > 0) reportMissingConfig("Telegram order notifications", [`${invalid} invalid entr${invalid === 1 ? "y" : "ies"} in TELEGRAM_CHAT_IDS (ignored)`]);
  if (!token || chatIds.length === 0) {
    reportMissingConfig("Telegram order notifications", [!token && "TELEGRAM_BOT_TOKEN", chatIds.length === 0 && "TELEGRAM_CHAT_IDS"].filter(Boolean) as string[]);
    return null;
  }
  return { token, chatIds, siteUrl, invalidChatIds: invalid };
}

/**
 * Delivers notification events after the response is sent (waitUntil on
 * Workers), so checkout never waits on Telegram. Each send has a 5 s timeout.
 */
export function scheduleNotifications(eventIds: string[]) {
  after(async () => {
    const db = await getDb();
    // Kill switch on (E2E, tests, quiet local work): these alerts are for
    // throwaway orders. Suppress them permanently and do not run retries.
    if (await outboundIntegrationsDisabled()) return suppressNotifications(db, eventIds);
    await dispatchPending(db, await getNotifierConfig(), eventIds);
  });
}
