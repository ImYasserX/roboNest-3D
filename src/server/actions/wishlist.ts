"use server";

import { z } from "zod";
import { getCurrentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { toggleWishlist } from "@/server/services/engagement";

export async function toggleWishlistAction(productId: string): Promise<{ ok: true; saved: boolean } | { ok: false; error: "unauthorized" | "invalid" }> {
  if (!z.string().uuid().safeParse(productId).success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const result = await toggleWishlist(await getDb(), user.id, productId);
  return result.ok ? { ok: true, saved: result.saved } : { ok: false, error: "invalid" };
}
