import { execSync } from "node:child_process";
import { ADMIN, CUSTOMER } from "./fixtures";

// Resets local D1/R2 to a known state with known admin credentials.
export default function globalSetup() {
  execSync("npx tsx --conditions=react-server scripts/seed.ts --reset", {
    stdio: "inherit",
    env: {
      ...process.env,
      SEED_SUPER_ADMIN_PASSWORD: ADMIN.super.password,
      SEED_OPS_ADMIN_PASSWORD: ADMIN.ops.password,
      SEED_SUPER_ADMIN_TOTP_SECRET: ADMIN.super.totpSecret,
      SEED_WHATSAPP: "07700000000",
      SEED_CUSTOMER_NAME: CUSTOMER.name,
      SEED_CUSTOMER_PHONE: CUSTOMER.phone,
      SEED_CUSTOMER_PASSWORD: CUSTOMER.password,
      SEED_MANUAL_DEPOSIT_APPROVED_BY: "E2E test fixture",
    },
  });
}
