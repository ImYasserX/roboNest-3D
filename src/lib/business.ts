// Confirmed RoboNest.3D contact details (owner-supplied, 2026-10-10). Every
// page that shows contact information reads them from here so they cannot
// drift apart. No timezone, response-time promise or 24/7 claim is made.

export const BUSINESS = {
  name: "RoboNest.3D",
  email: "support@robonest.tech",
  /** Display format and tel: form. */
  phones: [
    { display: "0751-891-1112", tel: "+9647518911112" },
    { display: "0751-546-9566", tel: "+9647515469566" },
  ],
  hours: { en: "9:00 AM to 9:00 PM", ar: "من ٩:٠٠ صباحاً إلى ٩:٠٠ مساءً" },
  /** WhatsApp chat number (owner-confirmed 2026-10-12): 0751-891-1112. */
  whatsapp: { display: "0751-891-1112", e164: "+9647518911112" },
} as const;

/**
 * Official click-to-chat URL: https://wa.me/<country code + number, digits
 * only, no leading domestic 0>. Opens the WhatsApp app on phones and
 * WhatsApp Web (or the desktop app) on computers.
 */
export function businessWhatsappUrl(text?: string): string {
  const digits = BUSINESS.whatsapp.e164.replace(/\D/g, "");
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
}
