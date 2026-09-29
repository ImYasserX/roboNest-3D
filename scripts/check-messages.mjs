// Fails if en.json and ar.json do not have identical key sets, or if any
// value is empty. Run by `npm run check:i18n` (part of `npm test`).
import { readFileSync } from "node:fs";

function flatten(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

const en = flatten(JSON.parse(readFileSync("messages/en.json", "utf8")));
const ar = flatten(JSON.parse(readFileSync("messages/ar.json", "utf8")));
const problems = [];
for (const key of en.keys()) if (!ar.has(key)) problems.push(`missing in ar: ${key}`);
for (const key of ar.keys()) if (!en.has(key)) problems.push(`missing in en: ${key}`);
for (const [name, map] of [["en", en], ["ar", ar]]) {
  for (const [key, value] of map) {
    if (value === "" || value === null) problems.push(`empty in ${name}: ${key}`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`i18n OK: ${en.size} keys in both locales`);
