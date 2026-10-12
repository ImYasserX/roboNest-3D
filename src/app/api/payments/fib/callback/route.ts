// RETIRED (2026-10-12): automatic online payments are not used. Payments are
// confirmed manually by an Owner after the customer contacts RoboNest.3D on
// WhatsApp (services/payment-verification.ts). This route no longer reads the
// body, calls any provider or touches any record; it only answers 410 Gone.
// POSTs from other origins are also refused by the middleware's same-origin
// check (the former callback exemption was removed).
const gone = () => new Response("Gone", { status: 410, headers: { "Cache-Control": "no-store" } });
export const GET = gone;
export const POST = gone;
