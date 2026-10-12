/**
 * LOCAL access recovery: writes a SQL file that sets a new password for one
 * admin (owner or staff), clears its lockout, signs out its sessions, and
 * optionally resets its authenticator so it must re-enroll TOTP.
 *
 *   npm run admin:reset -- <username> [--reset-totp]
 *   npx wrangler d1 execute robonest-3d --local --file=.admin-reset.sql
 *   rm .admin-reset.sql
 *
 * Nothing is applied by this script. The new password is typed hidden and
 * only its PBKDF2 hash goes into the git-ignored file. Use it on the LOCAL
 * database. For production, prefer the admin UI (an owner resets the other
 * owner); applying this file with --remote is an owner-approved emergency step.
 * It cannot change roles or disable owners (the database triggers forbid that).
 */
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { hashPassword } from "@/server/auth/password";
import { ADMIN_PASSWORD_MIN } from "@/server/services/admin-auth";

const args = process.argv.slice(2);
const username = (args.find((a) => !a.startsWith("--")) ?? "").toLowerCase();
const resetTotp = args.includes("--reset-totp");
if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
  console.error("Usage: npm run admin:reset -- <username> [--reset-totp]");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
const out = rl as unknown as { _writeToOutput: (s: string) => void };
const write = out._writeToOutput.bind(rl);
out._writeToOutput = (s: string) => {
  if (!muted || s.includes("\n") || s.includes("\r")) write(s);
};
const lines = rl[Symbol.asyncIterator]();
async function ask(q: string) {
  process.stdout.write(q);
  muted = true;
  const { value } = await lines.next();
  muted = false;
  if (process.stdin.isTTY) process.stdout.write("\n");
  return String(value ?? "").trim();
}

(async () => {
  const password = await ask(`New password for ${username} (min ${ADMIN_PASSWORD_MIN} chars, hidden): `);
  if (password.length < ADMIN_PASSWORD_MIN) throw new Error("Password too short");
  if (password !== (await ask("Repeat password: "))) throw new Error("Passwords do not match");
  rl.close();
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const now = Date.now();
  const sql = [
    `UPDATE admin_users SET password_hash = ${q(await hashPassword(password))}, password_changed_at = ${now}, failed_login_count = 0, locked_until = NULL${resetTotp ? ", totp_enabled = 0, totp_secret_enc = NULL, totp_last_counter = NULL" : ""}, updated_at = ${now} WHERE username = ${q(username)};`,
    `DELETE FROM admin_sessions WHERE admin_id = (SELECT id FROM admin_users WHERE username = ${q(username)});`,
    "",
  ].join("\n");
  writeFileSync(".admin-reset.sql", sql, { mode: 0o600 });
  console.log(`Wrote .admin-reset.sql for ${username}${resetTotp ? " (authenticator reset: enroll again at next sign-in)" : ""}.\nApply locally:\n  npx wrangler d1 execute robonest-3d --local --file=.admin-reset.sql\n  rm .admin-reset.sql\nIf the username does not exist, the file changes nothing.`);
})().catch((error) => {
  rl.close();
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
