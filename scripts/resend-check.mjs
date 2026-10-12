// Contact-form email (Resend): configuration check and ONE controlled test.
// The API key is never printed.
//
//   node scripts/resend-check.mjs
//       Checks variables, public DNS records and Resend's own domain status
//       (read-only API call). Sends NOTHING.
//
//   node scripts/resend-check.mjs --send --to you@your-inbox.example
//       Sends exactly one test email from CONTACT_FROM_EMAIL to --to, after
//       you type SEND to confirm. --to is required: it never defaults to
//       anyone, so mail only goes to an inbox you chose.
//
// Values come from the environment, then .dev.vars, then .env.local (with a
// warning: keep secrets in .dev.vars; .env* files are copied into builds).
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

function fileVar(file, name) {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^"|"$/g, "") || undefined;
}
const sources = {};
function value(name) {
  if (process.env[name]) {
    sources[name] = "environment";
    return process.env[name];
  }
  const dv = fileVar(".dev.vars", name);
  if (dv) {
    sources[name] = ".dev.vars";
    return dv;
  }
  const el = fileVar(".env.local", name);
  if (el) {
    sources[name] = ".env.local";
    return el;
  }
  return undefined;
}
function wranglerVar(name) {
  if (!existsSync("wrangler.jsonc")) return undefined;
  return new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`).exec(readFileSync("wrangler.jsonc", "utf8"))?.[1];
}

/**
 * Public DNS via DNS-over-HTTPS (Cloudflare), so results do not depend on the
 * local resolver (some drop large TXT answers such as DKIM keys). Read-only.
 */
async function doh(name, type) {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res?.ok) return [];
  const json = await res.json().catch(() => ({}));
  return (json.Answer ?? []).filter((a) => a.type === (type === "TXT" ? 16 : 15)).map((a) => String(a.data));
}

const PLAIN = /^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/;
const senderAddress = (v) => {
  const m = /^\s*(?:[^<>"\r\n]{1,80}\s)?<([^<>]+)>\s*$/.exec(v);
  const a = (m ? m[1] : v).trim();
  return PLAIN.test(a) ? a : null;
};

const args = process.argv.slice(2);
const send = args.includes("--send");
const to = args.includes("--to") ? args[args.indexOf("--to") + 1] : undefined;

const apiKey = value("RESEND_API_KEY");
const from = value("CONTACT_FROM_EMAIL");
let recipient = value("CONTACT_FORM_EMAIL");
if (!recipient) {
  sources.CONTACT_FORM_EMAIL = "wrangler.jsonc vars";
  recipient = wranglerVar("CONTACT_FORM_EMAIL");
}
const problems = [];
const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m) => {
  problems.push(m);
  console.log(`  FAIL  ${m}`);
};
const note = (m) => console.log(`  NOTE  ${m}`);

console.log("Variables");
if (apiKey) ok(`RESEND_API_KEY set (${sources.RESEND_API_KEY}; value hidden)`);
else bad("RESEND_API_KEY missing");
if (apiKey && !/^re_[A-Za-z0-9_]{10,}$/.test(apiKey)) bad("RESEND_API_KEY does not look like a Resend key (re_...)");
if (recipient === "contact@robonest.tech") ok(`CONTACT_FORM_EMAIL = contact@robonest.tech (${sources.CONTACT_FORM_EMAIL})`);
else bad(`CONTACT_FORM_EMAIL should be contact@robonest.tech (found: ${recipient ?? "nothing"})`);
const sender = from ? senderAddress(from) : null;
if (!from) bad("CONTACT_FROM_EMAIL missing");
else if (!sender) bad("CONTACT_FROM_EMAIL is not name@domain or Name <name@domain>");
else ok(`CONTACT_FROM_EMAIL = ${from} (${sources.CONTACT_FROM_EMAIL})`);
if (sender && recipient && sender.toLowerCase() === recipient.toLowerCase()) bad("CONTACT_FROM_EMAIL must be separate from CONTACT_FORM_EMAIL; use e.g. RoboNest.3D <no-reply@robonest.tech> (the app refuses to send otherwise)");
for (const n of ["RESEND_API_KEY", "CONTACT_FROM_EMAIL"]) {
  if (sources[n] === ".env.local") note(`${n} comes from .env.local. Move it to .dev.vars: .env* values are copied into build bundles and npm run cf:build refuses them.`);
}

const domain = sender?.split("@")[1];
if (domain) {
  console.log(`\nPublic DNS for ${domain} (read-only lookups)`);
  const txt = async (h) => (await doh(h, "TXT")).map((d) => d.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
  const mx = async (h) => (await doh(h, "MX")).map((d) => d.split(/\s+/).pop());
  if ((await txt(`resend._domainkey.${domain}`)).some((t) => t.includes("p="))) ok(`DKIM resend._domainkey.${domain} present`);
  else bad(`DKIM resend._domainkey.${domain} missing`);
  if ((await txt(`send.${domain}`)).some((t) => t.startsWith("v=spf1") && t.includes("amazonses.com"))) ok(`SPF on send.${domain} present`);
  else bad(`SPF on send.${domain} missing`);
  if ((await mx(`send.${domain}`)).some((h) => h.includes("amazonses.com"))) ok(`MX (bounce/return path) on send.${domain} present`);
  else bad(`MX on send.${domain} missing`);
  const dmarc = (await txt(`_dmarc.${domain}`)).find((t) => t.startsWith("v=DMARC1"));
  if (dmarc) ok(`DMARC present (${/p=\w+/.exec(dmarc)?.[0] ?? "policy?"})`);
  else note("no DMARC record (recommended, not required)");
}
const rdomain = recipient?.split("@")[1];
if (rdomain) {
  const inbound = (await doh(rdomain, "MX")).map((d) => d.split(/\s+/).pop().replace(/\.$/, ""));
  if (inbound.length) ok(`inbound MX for ${rdomain}: ${inbound.join(", ")}`);
  else bad(`no inbound MX for ${rdomain}: contact@ cannot receive mail`);
  if (inbound.some((h) => h.includes("porkbun"))) note(`inbound mail uses Porkbun email forwarding: confirm in Porkbun that ${recipient} forwards to an inbox you read (DNS cannot show this)`);
}

if (apiKey && domain) {
  console.log(`\nResend domain status (read-only API call, sends nothing)`);
  const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res) note("could not reach api.resend.com");
  else if (res.status === 401 || res.status === 403) note(`Resend refused the domain list (${res.status}); a "sending access" key cannot read domains. Check Resend dashboard → Domains instead.`);
  else if (!res.ok) note(`Resend answered ${res.status}`);
  else {
    const list = (await res.json().catch(() => ({}))).data ?? [];
    const d = list.find((x) => x.name === domain);
    if (!d) bad(`${domain} is not a domain in this Resend account`);
    else {
      if (d.status === "verified") ok(`Resend reports ${domain} as verified (region ${d.region})`);
      else bad(`Resend reports ${domain} as "${d.status}" (region ${d.region})`);
      const detail = await fetch(`https://api.resend.com/domains/${d.id}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
      for (const r of detail?.records ?? []) console.log(`        ${String(r.record).padEnd(6)} ${String(r.type).padEnd(4)} ${String(r.name).padEnd(22)} ${r.status}`);
    }
  }
}

if (!send) {
  console.log(problems.length ? `\n${problems.length} problem(s). Nothing was sent.` : "\nAll checks passed. Nothing was sent.");
  process.exit(problems.length ? 1 : 0);
}

// ---- One controlled send -------------------------------------------------------
if ((process.env.OUTBOUND_INTEGRATIONS ?? fileVar(".dev.vars", "OUTBOUND_INTEGRATIONS")) === "disabled") {
  console.error("\nOUTBOUND_INTEGRATIONS=disabled is set, so nothing was sent. To send this one test, run:\n  OUTBOUND_INTEGRATIONS=enabled npm run email:test -- --to <your inbox>");
  process.exit(1);
}
if (!to || !PLAIN.test(to)) {
  console.error("\n--send needs --to <an inbox you control>. Nothing was sent.");
  process.exit(1);
}
if (problems.length) {
  console.error("\nFix the problems above first. Nothing was sent.");
  process.exit(1);
}
console.log(`\nAbout to send ONE email\n  from: ${from}\n  to:   ${to}\n  subject: RoboNest.3D email test`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise((r) => rl.question('Type SEND to confirm: ', r));
rl.close();
if (answer.trim() !== "SEND") {
  console.log("Cancelled. Nothing was sent.");
  process.exit(1);
}
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ from, to: [to], subject: "RoboNest.3D email test", text: `Controlled test from scripts/resend-check.mjs at ${new Date().toISOString()}. Sender: ${from}.` }),
  signal: AbortSignal.timeout(10_000),
}).catch(() => null);
const body = res ? await res.json().catch(() => ({})) : {};
if (res?.ok && typeof body.id === "string") {
  console.log(`Resend accepted the email (id ${body.id}). Check the inbox (and spam folder) of ${to}.`);
  process.exit(0);
}
// Resend error messages do not contain the key.
console.error(`Resend did not accept the email: ${res ? res.status : "network error"} ${body.message ?? ""}`.trim());
process.exit(1);
