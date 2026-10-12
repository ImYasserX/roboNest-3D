import type { Database } from "@/server/db/client";
import { DEPOSIT_METHODS } from "@/lib/domain";
import { getSetting } from "./settings";

// Payment instructions shown to customers next to the WhatsApp payment step
// (e.g. an FIB / QiCard / ZainCash account to transfer to). They are
// information only: no customer action marks anything paid. Confirmation is
// services/payment-verification.ts (Owner, payments.verify).
//
// The former customer "report a transfer reference" step and the FIB online
// adapter were retired on 2026-10-12 (manual WhatsApp verification instead).
// Orders still in DEPOSIT_SUBMITTED from before can be confirmed or rejected
// by an Owner like any other deposit.

/** Enabled transfer methods with their localized instructions. */
export async function enabledDepositMethods(db: Database, locale: string) {
  const payments = await getSetting(db, "payments");
  return DEPOSIT_METHODS.filter((m) => payments.methods[m].enabled && (payments.methods[m].instructions.en || payments.methods[m].instructions.ar)).map((m) => ({
    code: m,
    instructions: locale === "ar" ? payments.methods[m].instructions.ar || payments.methods[m].instructions.en : payments.methods[m].instructions.en || payments.methods[m].instructions.ar,
  }));
}
