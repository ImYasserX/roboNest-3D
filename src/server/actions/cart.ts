"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { getCartOwner } from "@/server/cart-owner";
import { getRequestMeta } from "@/server/request-meta";
import { addToCart, getCartView, removeCartItem, updateCartItemQuantity } from "@/server/services/cart";
import { consumeRateLimit, consumeScoped } from "@/server/services/rate-limit";
import { evaluateDiscount } from "@/lib/pricing";
import { lookupDiscount } from "@/server/services/orders";
import type { LineError } from "@/lib/pricing";

export type CartActionResult =
  | { ok: true; itemCount: number }
  | { ok: false; error: string; lineErrors?: LineError[] };

const selectionValue = z.union([z.string().max(2000), z.array(z.string().max(64)).max(20), z.number(), z.boolean()]);
const addSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int(),
  // Only raw selections are accepted. Any price the client might send is ignored.
  options: z.record(z.string().max(64), selectionValue).refine((o) => Object.keys(o).length <= 30),
});

async function limited() {
  const { ipHash } = await getRequestMeta();
  const owner = await getCartOwner({ create: false });
  const key = owner ? (owner.userId ? `user:${owner.userId}` : `visitor:${owner.visitorHash}`) : null;
  return !(await consumeScoped(await getDb(), "cartWrite", "cartWriteIp", key, ipHash));
}

export async function addToCartAction(raw: unknown): Promise<CartActionResult> {
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_value" };
  if (await limited()) return { ok: false, error: "rate_limited" };
  const db = await getDb();
  const owner = (await getCartOwner({ create: true }))!;
  const result = await addToCart(db, owner, parsed.data);
  if (!result.ok) {
    return typeof result.error === "string" ? { ok: false, error: result.error } : { ok: false, error: "line", lineErrors: result.error.lineErrors };
  }
  refresh();
  return { ok: true, itemCount: (await getCartView(db, owner)).itemCount };
}

const updateSchema = z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().int().min(0).max(100) });

/** Form action used by the cart page (works without JavaScript). */
export async function updateCartItemAction(formData: FormData): Promise<void> {
  const parsed = updateSchema.safeParse({ itemId: formData.get("itemId"), quantity: formData.get("quantity") });
  if (!parsed.success || (await limited())) return;
  const owner = await getCartOwner({ create: false });
  if (!owner) return;
  await updateCartItemQuantity(await getDb(), owner, parsed.data.itemId, parsed.data.quantity);
  refresh();
}

export async function removeCartItemAction(formData: FormData): Promise<void> {
  const itemId = z.string().uuid().safeParse(formData.get("itemId"));
  if (!itemId.success || (await limited())) return;
  const owner = await getCartOwner({ create: false });
  if (!owner) return;
  await removeCartItem(await getDb(), owner, itemId.data);
  refresh();
}

/** Checks a discount code against the current cart subtotal (display only; checkout re-validates). */
export async function previewDiscountAction(code: string): Promise<{ ok: true; amount: number } | { ok: false; error: string }> {
  if (typeof code !== "string" || code.length > 40) return { ok: false, error: "discount_invalid" };
  const db = await getDb();
  const { ipHash } = await getRequestMeta();
  if (!(await consumeRateLimit(db, "checkoutIp", `discount:${ipHash}`))) return { ok: false, error: "rate_limited" };
  const cart = await getCartView(db, await getCartOwner({ create: false }));
  const result = evaluateDiscount(await lookupDiscount(db, code), cart.subtotal);
  return result.ok ? { ok: true, amount: result.amount } : { ok: false, error: `discount_${result.error}` };
}
