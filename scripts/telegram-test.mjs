// Sends a fixed TEST message to every configured owner chat, directly from
// this computer. It does not use the app, the database or Cloudflare: no
// order, outbox row or production data is created. The token is never printed.
//
//   node scripts/telegram-test.mjs --check   # verify token + each chat, sends NOTHING
//   node scripts/telegram-test.mjs           # send the test message to each chat
//
// Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_IDS from the environment or
// .dev.vars (the token can also be typed at a hidden prompt). To test the
// production values, run it with the same token at the prompt and
// TELEGRAM_CHAT_IDS=... in the environment.
import { botApi, botToken, devVar, outboundDisabled, parseChatIds } from "./lib/telegram-cli.mjs";

const checkOnly = process.argv.includes("--check");
if (!checkOnly && outboundDisabled()) {
  console.error("OUTBOUND_INTEGRATIONS=disabled is set, so no message was sent. To send this one test, run:\n  OUTBOUND_INTEGRATIONS=enabled npm run telegram:test");
  process.exit(1);
}
const rawIds = process.env.TELEGRAM_CHAT_IDS || devVar("TELEGRAM_CHAT_IDS") || process.env.TELEGRAM_CHAT_ID || devVar("TELEGRAM_CHAT_ID");
const { ids, invalid } = parseChatIds(rawIds);
if (invalid.length) console.error(`Ignoring ${invalid.length} invalid entr${invalid.length === 1 ? "y" : "ies"} in TELEGRAM_CHAT_IDS. The app ignores them too; fix the value.`);
if (ids.length === 0) {
  console.error("TELEGRAM_CHAT_IDS is not set (environment or .dev.vars). Nothing was sent.");
  process.exit(1);
}
if (ids.length < 2) console.warn(`Only ${ids.length} chat id configured; both owners should be listed.`);

const call = botApi(await botToken());
const me = await call("getMe");
if (!me.ok) {
  console.error(`Bot token rejected by Telegram: ${me.description}. Create a new token with @BotFather (/token).`);
  process.exit(1);
}
console.log(`Bot: @${me.result.username}`);

const hint = (d = "") =>
  /403|blocked|initiate/i.test(d) ? "this person has not pressed Start on the bot, or blocked it"
  : /chat not found|400/i.test(d) ? "wrong chat id, or this person never started the bot"
  : /429/.test(d) ? "rate limited; wait and retry"
  : "see the error text";

let failures = 0;
for (const id of ids) {
  const masked = `…${id.slice(-4)}`;
  if (checkOnly) {
    const chat = await call("getChat", { chat_id: id });
    if (chat.ok) console.log(`  OK    chat ${masked}  ${[chat.result.first_name, chat.result.last_name].filter(Boolean).join(" ")}${chat.result.username ? ` (@${chat.result.username})` : ""}`);
    else {
      failures++;
      console.log(`  FAIL  chat ${masked}  ${chat.description} (${hint(chat.description)})`);
    }
    continue;
  }
  const sent = await call("sendMessage", {
    chat_id: id,
    text: `RoboNest.3D test notification. This is NOT an order. If you see this, order alerts reach this chat. (${new Date().toISOString()})`,
    disable_web_page_preview: true,
  });
  if (sent.ok) console.log(`  SENT  chat ${masked}`);
  else {
    failures++;
    console.log(`  FAIL  chat ${masked}  ${sent.description} (${hint(sent.description)})`);
  }
}
console.log(failures ? `\n${failures} of ${ids.length} chats failed.` : `\nAll ${ids.length} chats ${checkOnly ? "are reachable (nothing was sent)" : "received the test message. Ask each owner to confirm on their phone"}.`);
process.exit(failures ? 1 : 0);
