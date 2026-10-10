// One-time local setup: creates .dev.vars (gitignored) with a random
// APP_SECRET and applies database migrations to the local D1 database.
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

if (!existsSync(".dev.vars")) {
  writeFileSync(
    ".dev.vars",
    `# Local development secrets (never commit). See README.md#environment.\nAPP_SECRET=${randomBytes(32).toString("base64url")}\nSITE_URL=http://localhost:3000\n`,
    { mode: 0o600 },
  );
  console.log("Created .dev.vars with a random APP_SECRET.");
} else {
  console.log(".dev.vars already exists; left unchanged.");
}
execSync("npx wrangler d1 migrations apply robonest-3d --local", { stdio: "inherit" });
