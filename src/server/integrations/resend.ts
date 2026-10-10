import { redact, withTimeout, type FetchLike } from "./http";

// Resend REST API (https://resend.com/docs/api-reference/emails/send-email).
// Called with fetch so no SDK is bundled into the Worker.

export type EmailConfig = { apiKey: string; from: string; to: string };

export type EmailMessage = { subject: string; text: string; replyTo?: string };

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: "rejected" | "network"; status?: number; detail: string };

const PLAIN_EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/;

/** "contact@robonest.tech" */
export function isPlainEmail(value: string) {
  return PLAIN_EMAIL.test(value);
}

/** "RoboNest.3D <no-reply@robonest.tech>" or "no-reply@robonest.tech"; returns the address part. */
export function senderAddress(value: string): string | null {
  const m = /^\s*(?:[^<>"\r\n]{1,80}\s)?<([^<>]+)>\s*$/.exec(value);
  const addr = (m ? m[1] : value).trim();
  return PLAIN_EMAIL.test(addr) ? addr : null;
}

/** Header values never contain line breaks (header injection). */
const headerSafe = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

export async function sendEmail(config: EmailConfig, message: EmailMessage, fetchImpl: FetchLike = fetch): Promise<SendEmailResult> {
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: headerSafe(config.from),
        to: [headerSafe(config.to)],
        subject: headerSafe(message.subject).slice(0, 200),
        text: message.text,
        ...(message.replyTo ? { reply_to: headerSafe(message.replyTo) } : {}),
      }),
      signal: withTimeout(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: "rejected", status: res.status, detail: redact(body, [config.apiKey]) };
    }
    // Resend answers { id } when it accepted the email; anything else is not a success.
    const json = (await res.json().catch(() => ({}))) as { id?: unknown };
    if (typeof json.id !== "string" || !json.id) return { ok: false, error: "rejected", status: res.status, detail: "accepted without an email id" };
    return { ok: true, id: json.id };
  } catch (error) {
    return { ok: false, error: "network", detail: redact(String((error as Error)?.name ?? error), [config.apiKey]) };
  }
}
