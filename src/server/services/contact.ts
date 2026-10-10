import { z } from "zod";
import type { Database } from "@/server/db/client";
import { contactMessages } from "@/server/db/schema";
import { hmacSha256Hex, timingSafeEqual } from "@/server/auth/crypto";
import { sendEmail, type EmailConfig } from "@/server/integrations/resend";
import type { FetchLike } from "@/server/integrations/http";

// Contact form: validate, email the business inbox through Resend, and keep a
// copy in D1 (admin → Messages) with the delivery outcome. The visitor is only
// told "sent" when Resend accepted the email.

const noControl = (s: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);
const MAX_LINKS = 3;

export const CONTACT_LIMITS = { name: 80, email: 120, subject: 120, messageMin: 10, messageMax: 3000 } as const;

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(CONTACT_LIMITS.name).refine(noControl),
  email: z.string().trim().toLowerCase().max(CONTACT_LIMITS.email).email(),
  subject: z.string().trim().min(2).max(CONTACT_LIMITS.subject).refine((s) => noControl(s) && !/[\r\n]/.test(s)),
  message: z
    .string()
    .trim()
    .min(CONTACT_LIMITS.messageMin)
    .max(CONTACT_LIMITS.messageMax)
    .refine(noControl)
    // Link-stuffed messages are almost always spam.
    .refine((s) => (s.match(/https?:\/\/|www\./gi)?.length ?? 0) <= MAX_LINKS, "too_many_links"),
  locale: z.enum(["ar", "en"]),
});

export type ContactResult =
  | { ok: true }
  | { ok: false; error: "invalid"; fields: string[] }
  | { ok: false; error: "not_configured" | "delivery_failed" };

/** Minimum seconds between rendering the form and submitting it (bots submit instantly). */
export const CONTACT_MIN_FILL_SECONDS = 3;
const FORM_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Signed render timestamp embedded in the form. */
export async function contactFormToken(secret: string, now = Date.now()) {
  return `${now}.${(await hmacSha256Hex(secret, `contact-form:${now}`)).slice(0, 32)}`;
}

export async function isHumanPaced(secret: string, token: unknown, now = Date.now()) {
  if (typeof token !== "string" || !/^\d{10,16}\.[0-9a-f]{32}$/.test(token)) return false;
  const [ts, mac] = token.split(".");
  const expected = (await hmacSha256Hex(secret, `contact-form:${ts}`)).slice(0, 32);
  if (!timingSafeEqual(mac, expected)) return false;
  const age = now - Number(ts);
  return age >= CONTACT_MIN_FILL_SECONDS * 1000 && age <= FORM_TOKEN_MAX_AGE_MS;
}

export function renderContactEmail(input: z.infer<typeof contactSchema>) {
  return {
    subject: `[RoboNest.3D contact] ${input.subject}`,
    text: [
      `Name: ${input.name}`,
      `Email: ${input.email}`,
      `Language: ${input.locale}`,
      `Subject: ${input.subject}`,
      "",
      input.message,
      "",
      "Sent from the RoboNest.3D contact form. Reply to this email to answer the customer.",
    ].join("\n"),
    replyTo: input.email,
  };
}

export async function submitContactMessage(
  db: Database,
  raw: unknown,
  email: { config: EmailConfig | null; fetchImpl?: FetchLike },
): Promise<ContactResult> {
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))] };
  const input = parsed.data;

  let deliveryStatus: "SENT" | "FAILED" | "NOT_CONFIGURED" = "NOT_CONFIGURED";
  if (email.config) {
    const sent = await sendEmail(email.config, renderContactEmail(input), email.fetchImpl);
    deliveryStatus = sent.ok ? "SENT" : "FAILED";
    // Status and provider detail only: never the API key or message body.
    if (!sent.ok) console.error("contact email failed", { error: sent.error, status: sent.ok ? undefined : sent.status, detail: sent.detail });
  }
  await db.insert(contactMessages).values({
    name: input.name,
    email: input.email,
    phone: null,
    subject: input.subject,
    message: input.message,
    locale: input.locale,
    deliveryStatus,
  });
  if (deliveryStatus === "SENT") return { ok: true };
  return { ok: false, error: deliveryStatus === "NOT_CONFIGURED" ? "not_configured" : "delivery_failed" };
}
