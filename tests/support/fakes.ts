import type { PhoneVerifier } from "@/server/integrations/twilio-verify";
import type { FetchLike } from "@/server/integrations/http";

/** In-memory SMS verifier: records sends; the code for every number is `code`. */
export function fakeVerifier(code = "123456", opts: { failStart?: boolean; checkError?: boolean } = {}) {
  const sent: string[] = [];
  const checks: { phone: string; code: string }[] = [];
  const verifier: PhoneVerifier = {
    channel: "SMS",
    async start(phone) {
      if (opts.failStart) return { ok: false, detail: "provider down" };
      sent.push(phone);
      return { ok: true };
    },
    async check(phone, c) {
      checks.push({ phone, code: c });
      if (opts.checkError) return "error";
      return sent.includes(phone) && c === code ? "approved" : "rejected";
    },
  };
  return { verifier, sent, checks };
}

/** Records requests and answers with the given responses in order (last one repeats). */
export function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r.clone();
  };
  return { fetchImpl, calls };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Awaits a query expected to fail and returns its message including the driver cause (Drizzle wraps SQLite errors). */
export async function dbError(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const e = error as Error & { cause?: unknown };
    return `${e.message} ${String(e.cause ?? "")}`;
  }
  return "no error";
}
