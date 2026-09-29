import "server-only";
import { getCurrentUser, getOrCreateVisitorHash, getVisitorHash } from "@/server/auth/current";
import type { CartOwner } from "@/server/services/cart";

/** The cart owner for this request: signed-in user, else anonymous visitor. */
export async function getCartOwner(opts: { create: boolean }): Promise<CartOwner | null> {
  const user = await getCurrentUser();
  if (user) return { userId: user.id };
  const visitorHash = opts.create ? await getOrCreateVisitorHash() : await getVisitorHash();
  return visitorHash ? { visitorHash } : null;
}
