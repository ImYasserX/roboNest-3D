import { NextResponse } from "next/server";
import { outboundIntegrationsDisabled } from "@/server/env";

// Liveness plus one safety flag used by the E2E suite before it creates any
// order: whether outbound integrations (email, Telegram, SMS, payments) are
// switched off. Reveals no configuration values.
export async function GET() {
  return NextResponse.json(
    { ok: true, outbound: (await outboundIntegrationsDisabled()) ? "disabled" : "enabled" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
