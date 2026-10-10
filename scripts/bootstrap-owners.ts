/**
 * One-time, protected provisioning of an OWNER account. Run once per owner,
 * by that owner, so nobody else ever knows their password:
 *
 *   npm run owner:bootstrap -- yasser      (or: ayman)
 *   npx wrangler d1 execute robonest-3d --remote --file=.owner-<key>.sql
 *   rm .owner-<key>.sql
 *
 * Then verify (prints no secrets):
 *   npx wrangler d1 execute robonest-3d --remote --command "SELECT username, display_name, role, status, totp_enabled FROM admin_users WHERE role = 'OWNER'"
 *
 * Owners must enroll an authenticator app (TOTP) at first sign-in before any
 * admin page opens. The OWNER role cannot be granted from the admin UI or any
 * public route; database triggers cap owners at two and block deleting,
 * demoting or disabling them.
 */
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { hashPassword } from "@/server/auth/password";
import { ADMIN_PASSWORD_MIN } from "@/server/services/admin-auth";
import { OWNERS, ownerInsertSql, type OwnerKey } from "./lib/owners";

const key = (process.argv[2] ?? "").toLowerCase() as OwnerKey;
if (!(key in OWNERS)) {
  console.error(`Usage: npm run owner:bootstrap -- <${Object.keys(OWNERS).join("|")}>`);
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
const rlOutput = rl as unknown as { _writeToOutput: (s: string) => void };
const writeToOutput = rlOutput._writeToOutput.bind(rl);
rlOutput._writeToOutput = (s: string) => {
  if (!muted || s.includes("\n") || s.includes("\r")) writeToOutput(s);
};
const lines = rl[Symbol.asyncIterator]();
async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const { value } = await lines.next();
  muted = false;
  if (hidden && process.stdin.isTTY) process.stdout.write("\n");
  return String(value ?? "").trim();
}

(async () => {
  const { displayName } = OWNERS[key];
  console.log(`Provisioning owner account for ${displayName}.`);
  const username = (await ask("Username (a-z, 0-9, . _ -): ")).toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("Invalid username");
  const password = await ask(`Password (min ${ADMIN_PASSWORD_MIN} chars, use a password manager): `, true);
  if (password.length < ADMIN_PASSWORD_MIN) throw new Error("Password too short");
  if (password !== (await ask("Repeat password: ", true))) throw new Error("Passwords do not match");
  rl.close();
  const file = `.owner-${key}.sql`;
  writeFileSync(file, ownerInsertSql({ id: crypto.randomUUID(), username, displayName, passwordHash: await hashPassword(password), now: Date.now() }), { mode: 0o600 });
  console.log(`\nWrote ${file} (contains only a PBKDF2 hash). Apply it, then delete it:\n  npx wrangler d1 execute robonest-3d --remote --file=${file}\n  rm ${file}`);
  console.log("At first sign-in the owner must enroll an authenticator app.");
})().catch((error) => {
  rl.close();
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
