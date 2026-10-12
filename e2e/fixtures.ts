import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

export const ADMIN = {
  super: { username: "dev-super", password: "e2e-super-admin-password", totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" },
  ops: { username: "dev-ops", password: "e2e-operations-password" },
  /** Exists only in the isolated E2E database (.wrangler/e2e-state); never a real owner. */
  owner: { username: "e2e-owner", password: "e2e-owner-test-password", totpSecret: "KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU" },
};

/** Seeded with an already verified phone: automated tests cannot receive SMS. */
export const CUSTOMER = { name: "E2E Customer", phone: "0790 111 2233", password: "e2e-customer-pass" };

function base32Decode(s: string) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s) {
    value = (value << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Current RFC 6238 code, as an authenticator app would show it. */
export function totp(secret: string, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 30_000) + offsetSteps;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = mac[mac.length - 1] & 15;
  return String(((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

/** Signs in as the seeded Super Admin, or the isolated test Owner (password + TOTP). */
export async function adminLogin(page: Page, who: "super" | "owner" = "super") {
  const account = ADMIN[who];
  await page.goto("/en/admin/login");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/verify/);
  // Codes are single-use (replay protection): if this 30 s step's code was
  // already used by an earlier test, wait for the next step, like a person would.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel("Authentication code").fill(totp(account.totpSecret));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL(/\/en\/admin$/, { timeout: 8_000 }).catch(() => undefined);
    if (/\/en\/admin$/.test(page.url())) return;
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  }
  throw new Error("TOTP sign-in failed");
}
