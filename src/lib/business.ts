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
} as const;
