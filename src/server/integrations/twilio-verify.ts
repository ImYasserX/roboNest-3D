import { redact, withTimeout, type FetchLike } from "./http";

// Twilio Verify (https://www.twilio.com/docs/verify/api). Twilio generates,
// sends and checks the code, so the OTP never exists in this application:
// nothing to store, log or leak. Iraq (+964) is a supported SMS destination;
// see Twilio's Iraq guidelines about sender registration for Asiacell.

export type TwilioVerifyConfig = { accountSid: string; authToken: string; serviceSid: string };

export type VerificationChannel = "SMS" | "WHATSAPP";

/**
 * One verification channel. Two styles are supported behind the same shape:
 * - provider-checked (Twilio Verify): the provider makes and checks the code;
 *   `start` returns no hash and `check` ignores `stored`.
 * - self-generated (WhatsApp Cloud API): we make the code, send it, and
 *   `start` returns only an HMAC of it, which the caller stores; `check`
 *   compares against that hash. The plaintext code is never stored.
 */
export type PhoneVerifier = {
  channel: VerificationChannel;
  /** Sends a code to an E.164 number. */
  start(phone: string, locale: string): Promise<{ ok: true; codeHash?: string } | { ok: false; detail: string }>;
  /** "approved" only when this code is valid for this number. */
  check(phone: string, code: string, stored: { codeHash: string | null }): Promise<"approved" | "rejected" | "error">;
};

export function createTwilioVerifier(config: TwilioVerifyConfig, fetchImpl: FetchLike = fetch): PhoneVerifier {
  const base = `https://verify.twilio.com/v2/Services/${encodeURIComponent(config.serviceSid)}`;
  const auth = `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`;
  const post = (path: string, form: Record<string, string>) =>
    fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: withTimeout(),
    });
  const secrets = [config.authToken];
  return {
    channel: "SMS",
    async start(phone, locale) {
      try {
        const res = await post("/Verifications", { To: phone, Channel: "sms", Locale: locale === "ar" ? "ar" : "en" });
        if (res.ok) return { ok: true };
        return { ok: false, detail: redact(`${res.status} ${await res.text().catch(() => "")}`, secrets) };
      } catch (error) {
        return { ok: false, detail: redact(String((error as Error)?.name ?? error), secrets) };
      }
    },
    async check(phone, code) {
      try {
        const res = await post("/VerificationCheck", { To: phone, Code: code });
        // 404: no pending verification (expired or already approved).
        if (res.status === 404) return "rejected";
        if (!res.ok) return "error";
        const json = (await res.json().catch(() => ({}))) as { status?: string; valid?: boolean };
        return json.status === "approved" && json.valid !== false ? "approved" : "rejected";
      } catch {
        return "error";
      }
    },
  };
}
