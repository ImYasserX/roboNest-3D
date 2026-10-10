// Fails the Cloudflare build when secret VALUES from .env files were copied
// into the Worker bundle. OpenNext writes every variable it finds in .env,
// .env.local, .env.production(.local) into .open-next/cloudflare/next-env.mjs,
// so a build made on a machine with real secrets in .env.local would ship them
// inside the deployed script. Prints variable NAMES only, never values.
//
// For a purely local test bundle you may bypass with CF_BUILD_ALLOW_ENV_SECRETS=1
// (the app ignores these values in built Workers anyway; see getServerVar).
import { existsSync, readFileSync } from "node:fs";

const SECRET_NAMES = [
  "APP_SECRET",
  "RESEND_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "WHATSAPP_ACCESS_TOKEN",
  "FIB_CLIENT_SECRET",
  "FIB_CLIENT_ID",
];
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

if (!existsSync(".open-next")) {
  console.log("Bundle check: no .open-next build found; nothing to check.");
  process.exit(0);
}
// Scan the whole bundle (not only next-env.mjs) so the check keeps working if
// OpenNext moves where it writes .env values.
function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) yield* files(path);
    else if (/\.(m?js|cjs|json)$/.test(entry) && st.size < 50 * 1024 * 1024) yield path;
  }
}
const found = new Set();
const patterns = SECRET_NAMES.map((n) => [n, new RegExp(`["']?${n}["']?\\s*:\\s*["'][^"']+["']`)]);
for (const path of files(".open-next")) {
  const text = readFileSync(path, "utf8");
  for (const [n, re] of patterns) if (!found.has(n) && text.includes(n) && re.test(text)) found.add(n);
}
if (found.size === 0) {
  console.log("Bundle check: no secrets from .env files in the Worker bundle.");
  process.exit(0);
}
const msg = `Bundle check: the Worker bundle contains values for ${[...found].join(", ")} copied from .env files (.env.local etc.).`;
if (process.env.CF_BUILD_ALLOW_ENV_SECRETS === "1") {
  console.warn(`WARNING ${msg}\nAllowed for a LOCAL test bundle only. Never deploy this build.`);
  process.exit(0);
}
console.error(`${msg}\nDo not deploy this build. Move those values to .dev.vars (local) or Worker secrets (production), remove them from .env* files, and rebuild.\nFor a local-only test bundle: CF_BUILD_ALLOW_ENV_SECRETS=1 npm run cf:build`);
process.exit(1);
