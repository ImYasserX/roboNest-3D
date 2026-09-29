"use server";

import { getLocale } from "next-intl/server";
import { getDb } from "@/server/db/client";
import { getRequestMeta } from "@/server/request-meta";
import { submitContactMessage } from "@/server/services/engagement";
import { consumeRateLimit } from "@/server/services/rate-limit";

export async function contactAction(_prev: { ok?: boolean; error?: string; fields?: string[] } | null, formData: FormData) {
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "contact", ipHash))) return { error: "rate_limited" };
  // Honeypot: real users never fill this hidden field.
  if (formData.get("website")) return { ok: true };
  const result = await submitContactMessage(db, {
    name: formData.get("name"),
    phone: formData.get("phone"),
    subject: formData.get("subject"),
    message: formData.get("message"),
    locale: await getLocale(),
  });
  return result.ok ? { ok: true } : { error: "invalid", fields: result.fields };
}
