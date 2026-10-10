// Lists the Telegram chats that have pressed Start on the RoboNest.3D bot, so
// you can fill TELEGRAM_CHAT_IDS. Runs LOCALLY only; the token is never printed.
//
//   node scripts/telegram-chat-ids.mjs
//
// Token source, in order: the TELEGRAM_BOT_TOKEN environment variable, the
// TELEGRAM_BOT_TOKEN line in .dev.vars, or a hidden prompt. Before running,
// each owner must open the bot in Telegram and press Start (or send "hi").
import { botApi, botToken } from "./lib/telegram-cli.mjs";

const api = botApi(await botToken());
async function call(method) {
  const res = await api(method);
  if (!res.ok) throw new Error(`${method}: ${res.description}`);
  return res.result;
}

try {
  const me = await call("getMe");
  console.log(`Bot: @${me.username} (${me.first_name})`);
  const updates = await call("getUpdates");
  const chats = new Map();
  for (const u of updates) {
    const chat = (u.message ?? u.my_chat_member ?? u.edited_message)?.chat;
    if (chat?.type === "private") chats.set(String(chat.id), [chat.first_name, chat.last_name].filter(Boolean).join(" ") + (chat.username ? ` (@${chat.username})` : ""));
  }
  if (chats.size === 0) {
    console.log("No private chats yet. Ask each owner to open the bot in Telegram, press Start, then run this again.");
    console.log("(Telegram keeps updates for about 24 hours; if the owners pressed Start earlier, ask them to send any message.)");
  } else {
    console.log("\nPrivate chats that started the bot:");
    for (const [id, name] of chats) console.log(`  ${id}  ${name}`);
    console.log(`\nCheck the names, then set (do not paste the token anywhere):\n  TELEGRAM_CHAT_IDS=${[...chats.keys()].join(",")}`);
  }
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(1);
}
