// WebCrypto helpers. Works identically in Cloudflare Workers and Node >= 20.

const encoder = new TextEncoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cryptographically random URL-safe token (default 256 bits). */
export function randomToken(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/** Constant-time comparison for equal-length secrets. */
export function timingSafeEqual(a: Uint8Array | string, b: Uint8Array | string): boolean {
  const x = typeof a === "string" ? encoder.encode(a) : a;
  const y = typeof b === "string" ? encoder.encode(b) : b;
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i % x.length] ?? 0) ^ (y[i % y.length] ?? 0);
  return diff === 0;
}

async function aesKey(secret: string, purpose: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("robonest-3d"), info: encoder.encode(purpose) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** AES-256-GCM encrypt; output is "v1.<iv>.<ciphertext>" base64url. */
export async function encryptString(secret: string, purpose: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret, purpose);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ct))}`;
}

export async function decryptString(secret: string, purpose: string, payload: string): Promise<string> {
  const [version, ivPart, ctPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !ctPart) throw new Error("Unsupported ciphertext");
  const key = await aesKey(secret, purpose);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(ivPart) as BufferSource },
    key,
    base64UrlToBytes(ctPart) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}
