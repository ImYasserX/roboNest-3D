"use server";

import { getLocale } from "next-intl/server";
import { getDb } from "@/server/db/client";
import { getAppSecret } from "@/server/env";
import { getRequestMeta } from "@/server/request-meta";
import { isHumanPaced, submitContactMessage } from "@/server/services/contact";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { contactEmailConfig } from "@/server/email-config";

export type ContactState = { ok?: boolean; error?: string; fields?: string[] } | null;


export async function contactAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "contact", ipHash))) return { error: "rate_limited" };
  // Honeypot and fill-time checks: answer like a success so bots learn nothing.
  if (formData.get("website")) return { ok: true };
  if (!(await isHumanPaced(await getAppSecret(), formData.get("ts")))) return { error: "too_fast" };
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 120);
  if (email && !(await consumeRateLimit(db, "contactEmail", email))) return { error: "rate_limited" };

  const result = await submitContactMessage(
    db,
    {
      name: formData.get("name"),
      email: formData.get("email"),
      subject: formData.get("subject"),
      message: formData.get("message"),
      locale: await getLocale(),
    },
    { config: await contactEmailConfig() },
  );
  if (result.ok) return { ok: true };
  return result.error === "invalid" ? { error: "invalid", fields: result.fields } : { error: "delivery_failed" };
}
