import { describe, expect, it } from "vitest";
import { decryptString, encryptString, randomToken, timingSafeEqual } from "@/server/auth/crypto";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { base32Decode, base32Encode, generateTotpSecret, totpCode, verifyTotp } from "@/server/auth/totp";

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^pbkdf2_sha256\$100000\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
  });
  it("salts every hash and rejects malformed stored values", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2_sha256$0$aa$bb")).toBe(false);
  });
});

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 test vector", async () => {
    // Secret "12345678901234567890"; T = 59s → counter 1 → 94287082 (8 digits) → 287082 (6 digits)
    const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
    expect(await totpCode(secret, 1)).toBe("287082");
  });
  it("round-trips base32", () => {
    const s = generateTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
  it("accepts ±1 step and rejects replays", async () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const counter = Math.floor(now / 30_000);
    const code = await totpCode(secret, counter);
    expect(await verifyTotp(secret, code, null, now)).toBe(counter);
    expect(await verifyTotp(secret, code, counter, now)).toBeNull();
    expect(await verifyTotp(secret, await totpCode(secret, counter + 5), null, now)).toBeNull();
    expect(await verifyTotp(secret, "12345", null, now)).toBeNull();
  });
});

describe("crypto helpers", () => {
  it("encrypts with AES-GCM and detects tampering", async () => {
    const secret = "x".repeat(40);
    const ct = await encryptString(secret, "totp", "JBSWY3DPEHPK3PXP");
    expect(await decryptString(secret, "totp", ct)).toBe("JBSWY3DPEHPK3PXP");
    await expect(decryptString("y".repeat(40), "totp", ct)).rejects.toThrow();
    await expect(decryptString(secret, "other-purpose", ct)).rejects.toThrow();
  });
  it("creates unique tokens and compares in constant time", () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
