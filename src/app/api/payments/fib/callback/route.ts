import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { scheduleNotifications } from "@/server/notify";
import { getDepositProvider } from "@/server/payments";
import { getRequestMeta } from "@/server/request-meta";
import { eventIdsForOrder } from "@/server/services/notifications";
import { checkOnlineDeposit } from "@/server/services/online-deposits";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { depositPayments } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";

// FIB status callback: { id, status }. The body is untrusted; it only tells us
// WHICH payment to re-check through FIB's authenticated status endpoint.
// Always answers 200 with no detail, so it cannot be used to probe payments.
const body = z.object({ id: z.string().trim().min(1).max(100), status: z.string().max(40).optional() });

export async function POST(request: Request) {
  const ok = NextResponse.json({ ok: true });
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "paymentCallback", ipHash))) return ok;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return ok;
  const provider = await getDepositProvider();
  if (!provider) return ok;
  const [known] = await db
    .select({ orderId: depositPayments.orderId })
    .from(depositPayments)
    .where(and(eq(depositPayments.provider, "FIB"), eq(depositPayments.providerPaymentId, parsed.data.id)))
    .limit(1);
  if (!known) return ok;
  const outcome = await checkOnlineDeposit(db, provider, { providerPaymentId: parsed.data.id });
  if (outcome === "verified") {
    const ids = await eventIdsForOrder(db, known.orderId);
    scheduleNotifications(ids);
  }
  return ok;
}
