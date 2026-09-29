import { base64UrlToBytes, bytesToBase64Url, timingSafeEqual } from "./crypto";

// PBKDF2-HMAC-SHA256 via WebCrypto. Cloudflare Workers caps PBKDF2 at 100,000
// iterations, and memory-hard algorithms (Argon2/scrypt) are not native there
// and would exceed Worker CPU limits in pure JS. The stored format carries the
// algorithm and iteration count so hashes can be upgraded on next login if the
// platform limit is raised. See SECURITY.md ("Password hashing").
const ALGORITHM = "pbkdf2_sha256";
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${ALGORITHM}$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsRaw, saltRaw, hashRaw] = stored.split("$");
  const iterations = Number(iterationsRaw);
  if (algorithm !== ALGORITHM || !saltRaw || !hashRaw || !Number.isInteger(iterations) || iterations < 1) {
    return false;
  }
  const expected = base64UrlToBytes(hashRaw);
  const actual = await derive(password, base64UrlToBytes(saltRaw), iterations);
  return timingSafeEqual(actual, expected);
}

/** A syntactically valid hash for a random password, used to equalize login timing. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))));
  return dummyHash;
}
