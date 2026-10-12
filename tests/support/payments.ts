import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { orders } from "@/server/db/schema";
import { confirmPayment } from "@/server/services/payment-verification";
import { paymentDue } from "@/lib/payment-due";

export const ownerActor = { adminId: null as unknown as string, label: "Test owner" };

/** Confirms whatever the order currently owes (deposit or full), as an Owner would after checking. */
export async function confirmDue(db: Database, orderId: string, channel: "WHATSAPP_TRANSFER" | "CASH_ON_DELIVERY" = "WHATSAPP_TRANSFER") {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  const due = paymentDue(order);
  if (!due) throw new Error("nothing due");
  const res = await confirmPayment(db, orderId, { kind: due.kind, receivedAmount: due.amount, channel, checked: true }, ownerActor);
  if (!res.ok) throw new Error(res.error);
  return due;
}
