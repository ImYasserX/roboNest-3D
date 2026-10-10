import "server-only";
import { getServerVar, reportMissingConfig } from "@/server/env";
import { isPlainEmail, senderAddress, type EmailConfig } from "@/server/integrations/resend";

export type EmailConfigStatus = { config: EmailConfig | null; problems: string[]; senderDomain: string | null };

/**
 * Contact-form email settings. CONTACT_FORM_EMAIL is the recipient (default
 * contact@robonest.tech via wrangler.jsonc vars); CONTACT_FROM_EMAIL is the
 * separate sender, which must be on a domain verified in Resend. Problems are
 * reported by variable name only, never by value.
 */
export async function contactEmailStatus(): Promise<EmailConfigStatus> {
  const [apiKey, to, from] = await Promise.all([getServerVar("RESEND_API_KEY"), getServerVar("CONTACT_FORM_EMAIL"), getServerVar("CONTACT_FROM_EMAIL")]);
  const problems: string[] = [];
  if (!apiKey) problems.push("RESEND_API_KEY missing");
  if (!to) problems.push("CONTACT_FORM_EMAIL missing");
  else if (!isPlainEmail(to)) problems.push("CONTACT_FORM_EMAIL is not a plain email address");
  const sender = from ? senderAddress(from) : null;
  if (!from) problems.push("CONTACT_FROM_EMAIL missing");
  else if (!sender) problems.push("CONTACT_FROM_EMAIL is not a valid sender (use name@domain or Name <name@domain>)");
  // The sender must be a separate address (e.g. no-reply@robonest.tech), not the inbox itself.
  else if (to && sender.toLowerCase() === to.trim().toLowerCase()) problems.push("CONTACT_FROM_EMAIL must be a separate address from CONTACT_FORM_EMAIL (e.g. no-reply@robonest.tech)");
  if (problems.length) {
    reportMissingConfig("Contact form email", problems);
    return { config: null, problems, senderDomain: sender?.split("@")[1] ?? null };
  }
  return { config: { apiKey: apiKey!, to: to!, from: from! }, problems, senderDomain: sender!.split("@")[1] };
}

export async function contactEmailConfig() {
  return (await contactEmailStatus()).config;
}
