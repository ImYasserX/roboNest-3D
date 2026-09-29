import { timingSafeEqual } from "./crypto";

// RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits) — compatible with Google
// Authenticator, Microsoft Authenticator, 1Password, Aegis, etc.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export async function totpCode(secretBase32: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secretBase32) as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return (binary % 1_000_000).toString().padStart(6, "0");
}

export function currentCounter(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Verifies a code within ±1 step of clock drift. Returns the matched counter so
 * the caller can persist it and reject any code at or before it (replay).
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  lastUsedCounter: number | null,
  nowMs = Date.now(),
): Promise<number | null> {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const now = currentCounter(nowMs);
  for (const counter of [now - 1, now, now + 1]) {
    if (lastUsedCounter !== null && counter <= lastUsedCounter) continue;
    if (timingSafeEqual(await totpCode(secretBase32, counter), normalized)) return counter;
  }
  return null;
}

export function totpUri(secretBase32: string, accountName: string, issuer = "RoboNest.3D"): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}
