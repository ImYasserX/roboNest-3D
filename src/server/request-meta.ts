import "server-only";
import { headers } from "next/headers";
import { getEnv } from "./env";
import { hmacSha256Hex } from "./auth/crypto";

export type RequestMeta = { ip: string; ipHash: string; userAgent: string };

/**
 * Client IP. On Cloudflare, cf-connecting-ip is set by the edge and cannot be
 * spoofed by the client; x-forwarded-for is only a local-development fallback.
 */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const ip =
    h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  const env = await getEnv();
  // IPs are stored only as keyed hashes (privacy); the key is APP_SECRET.
  const ipHash = (await hmacSha256Hex(env.APP_SECRET ?? "dev-only-ip-salt", ip)).slice(0, 32);
  return { ip, ipHash, userAgent: (h.get("user-agent") ?? "").slice(0, 200) };
}
