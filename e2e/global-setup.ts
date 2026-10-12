import { execSync } from "node:child_process";
import { ADMIN, CUSTOMER } from "./fixtures";
import { E2E_STATE } from "../playwright.config";

// Resets the E2E local D1/R2 (a separate folder, not your normal local data)
// to a known state with known admin credentials.
export default function globalSetup() {
  const isolated = !process.env.E2E_BASE_URL;
  // (Migrations for E2E_STATE are applied by the webServer command in playwright.config.ts.)
  execSync("npx tsx --conditions=react-server scripts/seed.ts --reset", {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(isolated ? { SEED_PERSIST_TO: E2E_STATE } : {}),
      SEED_SUPER_ADMIN_PASSWORD: ADMIN.super.password,
      SEED_OPS_ADMIN_PASSWORD: ADMIN.ops.password,
      SEED_SUPER_ADMIN_TOTP_SECRET: ADMIN.super.totpSecret,
      SEED_CUSTOMER_NAME: CUSTOMER.name,
      SEED_CUSTOMER_PHONE: CUSTOMER.phone,
      SEED_CUSTOMER_PASSWORD: CUSTOMER.password,
      ...(isolated ? { SEED_E2E_OWNER_PASSWORD: ADMIN.owner.password, SEED_E2E_OWNER_TOTP_SECRET: ADMIN.owner.totpSecret } : {}),
    },
  });
}
