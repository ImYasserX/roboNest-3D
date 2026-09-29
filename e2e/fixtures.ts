import { createHmac } from "node:crypto";

export const ADMIN = {
  super: { username: "owner", password: "e2e-super-admin-password", totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" },
  ops: { username: "operations", password: "e2e-operations-password" },
};

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
