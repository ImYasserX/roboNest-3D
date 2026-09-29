import { expect, it } from "vitest";
import { generateTotpSecret, totpCode, verifyTotp } from "@/server/auth/totp";

it("accepts codes from the next time-step (clock drift) after a previous use", async () => {
  const secret = generateTotpSecret();
  const now = 1_790_000_000_000;
  const c = Math.floor(now / 30_000);
  expect(await verifyTotp(secret, await totpCode(secret, c), null, now)).toBe(c);
  expect(await verifyTotp(secret, await totpCode(secret, c + 1), c, now)).toBe(c + 1);
  expect(await verifyTotp(secret, await totpCode(secret, c - 1), c, now)).toBeNull();
});
