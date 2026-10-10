// Small helpers shared by the outbound integrations. Kept framework-free so
// services can be tested with an injected fetch.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_TIMEOUT_MS = 8_000;

/** Removes every occurrence of each secret from a string before it is logged or stored. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  return out.slice(0, 300);
}

export function withTimeout(ms = DEFAULT_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}
