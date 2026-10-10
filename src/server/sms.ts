import "server-only";
import { getAppSecret, getServerVar, reportMissingConfig } from "@/server/env";
import { createTwilioVerifier, type PhoneVerifier, type VerificationChannel } from "@/server/integrations/twilio-verify";
import { createWhatsAppVerifier } from "@/server/integrations/whatsapp-otp";
import type { Verifiers } from "@/server/services/phone-verification";

/**
 * Configured verification channels. Twilio SMS stays the default; WhatsApp is
 * used first only when PHONE_VERIFICATION_PRIMARY=whatsapp AND it is fully
 * configured. Returns null when no channel exists: registration and SMS
 * recovery then stay disabled and no unverified number is ever accepted.
 */
export async function getPhoneVerifiers(): Promise<Verifiers | null> {
  const byChannel: Partial<Record<VerificationChannel, PhoneVerifier>> = {};

  const [accountSid, authToken, serviceSid] = await Promise.all([getServerVar("TWILIO_ACCOUNT_SID"), getServerVar("TWILIO_AUTH_TOKEN"), getServerVar("TWILIO_VERIFY_SERVICE_SID")]);
  if (accountSid && authToken && serviceSid) byChannel.SMS = createTwilioVerifier({ accountSid, authToken, serviceSid });

  const [waToken, waPhoneId, waVersion, waTemplate, waAr, waEn, primary] = await Promise.all([
    getServerVar("WHATSAPP_ACCESS_TOKEN"),
    getServerVar("WHATSAPP_PHONE_NUMBER_ID"),
    getServerVar("WHATSAPP_GRAPH_API_VERSION"),
    getServerVar("WHATSAPP_OTP_TEMPLATE_NAME"),
    getServerVar("WHATSAPP_OTP_TEMPLATE_LANGUAGE_AR"),
    getServerVar("WHATSAPP_OTP_TEMPLATE_LANGUAGE_EN"),
    getServerVar("PHONE_VERIFICATION_PRIMARY"),
  ]);
  const waAny = waToken || waPhoneId || waTemplate;
  if (waToken && waPhoneId && waVersion && waTemplate && (waAr || waEn)) {
    byChannel.WHATSAPP = createWhatsAppVerifier({ accessToken: waToken, phoneNumberId: waPhoneId, apiVersion: waVersion, templateName: waTemplate, languages: { ar: waAr, en: waEn } }, await getAppSecret());
  } else if (waAny || primary === "whatsapp") {
    reportMissingConfig("WhatsApp OTP", [
      !waToken && "WHATSAPP_ACCESS_TOKEN",
      !waPhoneId && "WHATSAPP_PHONE_NUMBER_ID",
      !waVersion && "WHATSAPP_GRAPH_API_VERSION",
      !waTemplate && "WHATSAPP_OTP_TEMPLATE_NAME",
      !waAr && !waEn && "WHATSAPP_OTP_TEMPLATE_LANGUAGE_AR/EN",
    ].filter(Boolean) as string[]);
  }

  const preferred = primary === "whatsapp" && byChannel.WHATSAPP ? byChannel.WHATSAPP : byChannel.SMS ?? byChannel.WHATSAPP;
  if (!preferred) {
    reportMissingConfig("Phone verification", ["TWILIO_* (SMS) or WHATSAPP_* (WhatsApp)"]);
    return null;
  }
  return { primary: preferred, byChannel };
}

/** Backwards-compatible: is any verification channel available? */
export async function getPhoneVerifier(): Promise<PhoneVerifier | null> {
  return (await getPhoneVerifiers())?.primary ?? null;
}
