import { hmacSha256Hex, timingSafeEqual } from "@/server/auth/crypto";
import { redact, withTimeout, type FetchLike } from "./http";
import type { PhoneVerifier } from "./twilio-verify";

// WhatsApp Business Platform (Cloud API), direct from Meta. OTPs are sent
// with an approved AUTHENTICATION template using a copy-code button
// (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates).
// Meta does not generate or check codes, so we do: a random 6-digit code is
// sent and only HMAC(APP_SECRET, phone|code) is returned for storage.
//
// A 200 from the Graph API means Meta ACCEPTED the message, not that it was
// delivered (delivery arrives later via webhooks, not implemented yet). The
// verification screen therefore offers "send by SMS instead" when Twilio is
// also configured.

export type WhatsAppConfig = {
  accessToken: string;
  phoneNumberId: string;
  /** Graph API version, e.g. "v23.0". Set explicitly; no default is guessed. */
  apiVersion: string;
  templateName: string;
  /** Template language codes as approved in WhatsApp Manager, e.g. { ar: "ar", en: "en_US" }. */
  languages: { ar?: string; en?: string };
};

export const OTP_DIGITS = 6;

/** Uniform random numeric code (rejection sampling, no modulo bias). */
export function generateOtp(digits = OTP_DIGITS): string {
  const max = 10 ** digits;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return String(buf[0] % max).padStart(digits, "0");
  }
}

export async function otpHash(secret: string, phone: string, code: string) {
  return hmacSha256Hex(secret, `wa-otp:${phone}:${code}`);
}

export function createWhatsAppVerifier(config: WhatsAppConfig, hmacSecret: string, fetchImpl: FetchLike = fetch, makeCode: () => string = generateOtp): PhoneVerifier {
  const url = `https://graph.facebook.com/${encodeURIComponent(config.apiVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`;
  return {
    channel: "WHATSAPP",
    async start(phone, locale) {
      const language = (locale === "ar" ? config.languages.ar ?? config.languages.en : config.languages.en ?? config.languages.ar) ?? "";
      if (!language) return { ok: false, detail: "no template language configured" };
      const code = makeCode();
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone.replace(/^\+/, ""),
            type: "template",
            template: {
              name: config.templateName,
              language: { code: language },
              components: [
                { type: "body", parameters: [{ type: "text", text: code }] },
                { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
              ],
            },
          }),
          signal: withTimeout(),
        });
        if (!res.ok) {
          // Graph errors never contain the code we generated, but redact the token and code anyway.
          return { ok: false, detail: redact(`${res.status} ${await res.text().catch(() => "")}`, [config.accessToken, code]) };
        }
        return { ok: true, codeHash: await otpHash(hmacSecret, phone, code) };
      } catch (error) {
        return { ok: false, detail: redact(String((error as Error)?.name ?? error), [config.accessToken]) };
      }
    },
    async check(phone, code, stored) {
      if (!stored.codeHash || !/^\d{4,10}$/.test(code)) return "rejected";
      return timingSafeEqual(await otpHash(hmacSecret, phone, code), stored.codeHash) ? "approved" : "rejected";
    },
  };
}
