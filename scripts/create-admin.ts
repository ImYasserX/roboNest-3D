/**
 * Creates an administrator for a real (remote) database without the dev seed.
 *
 *   npx tsx --conditions=react-server scripts/create-admin.ts
 *   npx wrangler d1 execute robonest-3d --remote --file=.admin-insert.sql
 *   rm .admin-insert.sql
 *
 * The password is read without echo and only its PBKDF2 hash is written to
 * the SQL file. The file is git-ignored; delete it after use.
 */
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { hashPassword } from "@/server/auth/password";
import { ADMIN_PASSWORD_MIN } from "@/server/services/admin-auth";

// One readline interface for every prompt (separate interfaces lose buffered
// input); password prompts suppress echo on interactive terminals.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
const rlOutput = rl as unknown as { _writeToOutput: (s: string) => void };
const writeToOutput = rlOutput._writeToOutput.bind(rl);
rlOutput._writeToOutput = (s: string) => {
  if (!muted || s.includes("\n") || s.includes("\r")) writeToOutput(s);
};

// Lines are consumed through the async iterator, which buffers input (piped
// or typed) so no answer is lost between prompts.
const lines = rl[Symbol.asyncIterator]();

async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const { value } = await lines.next();
  muted = false;
  if (hidden && process.stdin.isTTY) process.stdout.write("\n");
  return String(value ?? "").trim();
}

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

(async () => {
  const username = (await ask("Username (a-z, 0-9, . _ -): ")).toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("Invalid username");
  const displayName = await ask("Display name: ");
  if (displayName.length < 2 || displayName.length > 60) throw new Error("Display name must be 2-60 characters");
  const role = (await ask("Role [SUPER_ADMIN|OPERATIONS]: ")).toUpperCase();
  if (role !== "SUPER_ADMIN" && role !== "OPERATIONS") throw new Error("Invalid role");
  const password = await ask(`Password (min ${ADMIN_PASSWORD_MIN} chars): `, true);
  if (password.length < ADMIN_PASSWORD_MIN) throw new Error("Password too short");
  if (password !== (await ask("Repeat password: ", true))) throw new Error("Passwords do not match");

  const now = Date.now();
  const sql = `INSERT INTO admin_users (id, username, display_name, role, password_hash, totp_enabled, status, failed_login_count, password_changed_at, created_at, updated_at)
VALUES (${sqlString(crypto.randomUUID())}, ${sqlString(username)}, ${sqlString(displayName)}, ${sqlString(role)}, ${sqlString(await hashPassword(password))}, 0, 'ACTIVE', 0, ${now}, ${now}, ${now});\n`;
  rl.close();
  writeFileSync(".admin-insert.sql", sql, { mode: 0o600 });
  console.log("\nWrote .admin-insert.sql. Apply it with:\n  npx wrangler d1 execute robonest-3d --remote --file=.admin-insert.sql\nthen delete the file.");
  if (role === "SUPER_ADMIN") console.log("The Super Admin will be asked to enroll an authenticator app at first sign-in.");
})().catch((error) => {
  rl.close();
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
