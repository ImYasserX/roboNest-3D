/**
 * Protected provisioning of an OWNER account. Run once per owner, BY that
 * owner, in their own terminal, so nobody else ever knows their password.
 *
 * Local development database (.wrangler/state; never connects to Cloudflare):
 *   npm run owner:bootstrap -- yasser --local      (or: ayman)
 *   → checks the local D1, asks for the password (hidden, twice), applies the
 *     insert to the local D1, deletes the temporary SQL file and verifies.
 *
 * Production (OWNER APPROVAL, see docs/PRODUCTION_SETUP.md step 7):
 *   npm run owner:bootstrap -- yasser
 *   npx wrangler d1 execute robonest-3d --remote --file=.owner-yasser.sql
 *   rm .owner-yasser.sql
 *
 * The SQL file holds only the PBKDF2 hash, never the password, and is created
 * with mode 600. Passwords are never accepted as arguments or from a pipe.
 * Owners must enroll an authenticator app (TOTP) at first sign-in before any
 * admin page opens. The OWNER role cannot be granted from the admin UI or any
 * public route; database triggers cap owners at two and block deleting,
 * demoting or disabling them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { hashPassword } from "@/server/auth/password";
import { ADMIN_PASSWORD_MIN } from "@/server/services/admin-auth";
import { OWNERS, ownerInsertSql, type OwnerKey } from "./lib/owners";

const args = process.argv.slice(2);
const local = args.includes("--local");
const key = (args.find((a) => !a.startsWith("--")) ?? "").toLowerCase() as OwnerKey;
if (!(key in OWNERS)) {
  console.error(`Usage: npm run owner:bootstrap -- <${Object.keys(OWNERS).join("|")}> [--local]`);
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("Run this in an interactive terminal: the password is typed hidden and is never read from a pipe or an argument.");
  process.exit(1);
}

/** Runs a read-only query on the LOCAL D1 (wrangler --local; no Cloudflare connection). */
function localQuery<T>(sql: string): T[] {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "robonest-3d", "--local", "--json", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out)[0].results as T[];
}
const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
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
  if (hidden) process.stdout.write("\n");
  return String(value ?? "").trim();
}

type Row = { username: string; display_name: string; role: string; status: string; totp_enabled: number };

(async () => {
  const { displayName } = OWNERS[key];
  console.log(`Provisioning owner account for ${displayName}${local ? " in the LOCAL development database (.wrangler/state)" : ""}.`);
  const username = ((await ask(`Username [${key}] (a-z, 0-9, . _ -): `)) || key).toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("Invalid username");

  if (local) {
    // Never overwrite: stop if the username is taken or this owner already exists.
    const existing = localQuery<Row>(
      `SELECT username, display_name, role, status, totp_enabled FROM admin_users WHERE username = ${sqlString(username)} OR (role = 'OWNER' AND display_name = ${sqlString(displayName)})`,
    );
    if (existing.length) {
      rl.close();
      for (const r of existing) console.error(`Stopped: an account already exists: ${r.username} (${r.display_name}), role ${r.role}, status ${r.status}. Nothing was changed.`);
      console.error("To recover access instead, see docs/LOCAL_DEVELOPMENT.md (npm run admin:reset).");
      process.exit(1);
    }
    const owners = localQuery<{ n: number }>("SELECT COUNT(*) AS n FROM admin_users WHERE role = 'OWNER'")[0].n;
    if (owners >= 2) throw new Error("Two owner accounts already exist (the maximum). Nothing was changed.");
  }

  const password = await ask(`Password (min ${ADMIN_PASSWORD_MIN} chars, use a password manager; input hidden): `, true);
  if (password.length < ADMIN_PASSWORD_MIN) throw new Error("Password too short. Nothing was changed.");
  if (password !== (await ask("Repeat password: ", true))) throw new Error("Passwords do not match. Nothing was changed.");
  rl.close();

  const id = crypto.randomUUID();
  const file = `.owner-${key}.sql`;
  if (existsSync(file)) throw new Error(`${file} already exists from an earlier run; delete it first. Nothing was changed.`);
  writeFileSync(file, ownerInsertSql({ id, username, displayName, passwordHash: await hashPassword(password), now: Date.now() }), { mode: 0o600 });

  if (!local) {
    console.log(`\nWrote ${file} (contains only a PBKDF2 hash). Production only, with OWNER APPROVAL:\n  npx wrangler d1 execute robonest-3d --remote --file=${file}\n  rm ${file}`);
    console.log("At first sign-in the owner must enroll an authenticator app.");
    return;
  }
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", "robonest-3d", "--local", `--file=${file}`], { stdio: ["ignore", "ignore", "inherit"] });
  } finally {
    rmSync(file, { force: true });
  }
  const created = localQuery<Row & { id: string }>(`SELECT id, username, display_name, role, status, totp_enabled FROM admin_users WHERE id = ${sqlString(id)}`);
  if (created.length !== 1 || created[0].role !== "OWNER") throw new Error("The account was NOT created (the database rejected or skipped the insert).");
  const r = created[0];
  console.log(`\nCreated in the local database: ${r.username} (${r.display_name}), role ${r.role}, status ${r.status}, authenticator ${r.totp_enabled ? "enrolled" : "not enrolled yet"}.`);
  console.log(`Temporary file ${file} deleted.`);
  console.log("Sign in at http://localhost:3000/en/admin (npm run dev). You will be asked to enroll your own authenticator app first.");
})().catch((error) => {
  rl.close();
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
