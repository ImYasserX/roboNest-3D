import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { cartItems, carts, productImages, uploads } from "@/server/db/schema";
import { sha256Hex } from "@/server/auth/crypto";
import { MAX_CART_LINES, MAX_LINE_QUANTITY, typeHasDigital, typeHasPhysical, type ProductType } from "@/lib/domain";
import { canonicalJson, resolveLine, type LineError, type OptionSnapshot, type Selections } from "@/lib/pricing";
import { loadPricingProducts } from "./catalog";

export type CartOwner = { userId: string; visitorHash?: never } | { visitorHash: string; userId?: never };

export function ownerKeyFor(owner: CartOwner): string {
  return owner.userId ? `user:${owner.userId}` : `visitor:${owner.visitorHash}`;
}

function ownerWhere(owner: CartOwner) {
  return owner.userId ? eq(carts.userId, owner.userId) : eq(carts.visitorHash, owner.visitorHash!);
}

export async function findCart(db: Database, owner: CartOwner) {
  const [cart] = await db.select().from(carts).where(ownerWhere(owner)).limit(1);
  return cart ?? null;
}

async function getOrCreateCart(db: Database, owner: CartOwner) {
  const existing = await findCart(db, owner);
  if (existing) return existing;
  const [created] = await db
    .insert(carts)
    .values(owner.userId ? { userId: owner.userId } : { visitorHash: owner.visitorHash })
    .onConflictDoNothing()
    .returning();
  return created ?? (await findCart(db, owner))!;
}

export type CartLine = {
  id: string;
  productId: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  productType: ProductType;
  imageKey: string | null;
  quantity: number;
  selections: Selections;
  snapshot: OptionSnapshot[];
  uploadIds: string[];
  unitPrice: number;
  lineTotal: number;
  unitCost: number | null;
  isPhysical: boolean;
  isDigital: boolean;
  trackStock: boolean;
  errors: LineError[];
};

export type CartView = {
  cartId: string | null;
  lines: CartLine[];
  subtotal: number;
  itemCount: number;
  hasPhysical: boolean;
  hasDigital: boolean;
  isValid: boolean;
};

const EMPTY_CART: CartView = { cartId: null, lines: [], subtotal: 0, itemCount: 0, hasPhysical: false, hasDigital: false, isValid: true };

/** Re-prices every line from current database records. */
export async function getCartView(db: Database, owner: CartOwner | null): Promise<CartView> {
  if (!owner) return EMPTY_CART;
  const cart = await findCart(db, owner);
  if (!cart) return EMPTY_CART;
  const items = await db.select().from(cartItems).where(eq(cartItems.cartId, cart.id)).orderBy(asc(cartItems.createdAt));
  if (items.length === 0) return { ...EMPTY_CART, cartId: cart.id };

  const productIds = [...new Set(items.map((i) => i.productId))];
  const pricing = await loadPricingProducts(db, productIds);
  const images = await db
    .select({ productId: productImages.productId, key: productImages.r2Key })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.sortOrder));
  const imageByProduct = new Map<string, string>();
  for (const img of images) if (!imageByProduct.has(img.productId)) imageByProduct.set(img.productId, img.key);

  // Stock is shared across lines of the same product (different options).
  const stockUsed = new Map<string, number>();
  const lines: CartLine[] = items.map((item) => {
    const product = pricing.get(item.productId)!;
    const resolved = resolveLine(product, item.options, item.quantity);
    let errors = resolved.ok ? [] : resolved.errors;
    if (resolved.ok && product.availability === "IN_STOCK") {
      const used = (stockUsed.get(product.id) ?? 0) + item.quantity;
      stockUsed.set(product.id, used);
      if (used > (product.stockQuantity ?? 0)) errors = [{ code: "insufficient_stock" }];
    }
    const line = resolved.ok ? resolved.line : null;
    return {
      id: item.id,
      productId: item.productId,
      slug: product.row.slug,
      nameEn: product.row.nameEn,
      nameAr: product.row.nameAr,
      productType: product.productType,
      imageKey: imageByProduct.get(item.productId) ?? null,
      quantity: item.quantity,
      selections: line?.selections ?? item.options,
      snapshot: line?.snapshot ?? [],
      uploadIds: line?.uploadIds ?? [],
      unitPrice: line?.unitPrice ?? 0,
      lineTotal: errors.length === 0 && line ? line.lineTotal : 0,
      unitCost: product.row.costPrice,
      isPhysical: typeHasPhysical(product.productType),
      isDigital: typeHasDigital(product.productType),
      trackStock: product.availability === "IN_STOCK",
      errors,
    };
  });

  return {
    cartId: cart.id,
    lines,
    subtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    hasPhysical: lines.some((l) => l.isPhysical),
    hasDigital: lines.some((l) => l.isDigital),
    isValid: lines.every((l) => l.errors.length === 0),
  };
}

export type CartMutationError =
  | "not_found"
  | "too_many_lines"
  | "invalid_upload"
  | "invalid_quantity"
  | { lineErrors: LineError[] };

async function lineKeyFor(productId: string, selections: Selections) {
  return sha256Hex(`${productId}|${canonicalJson(selections)}`);
}

/** Uploads referenced by options must belong to the caller and be unattached. */
async function uploadsOwnedBy(db: Database, ownerKey: string, ids: string[]) {
  if (ids.length === 0) return true;
  const rows = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(and(inArray(uploads.id, ids), eq(uploads.ownerKey, ownerKey), eq(uploads.purpose, "PRODUCT_OPTION"), isNull(uploads.attachedId)));
  return rows.length === new Set(ids).size;
}

export async function addToCart(
  db: Database,
  owner: CartOwner,
  input: { productId: string; quantity: number; options: unknown },
): Promise<{ ok: true; itemId: string } | { ok: false; error: CartMutationError }> {
  const pricing = await loadPricingProducts(db, [input.productId]);
  const product = pricing.get(input.productId);
  if (!product) return { ok: false, error: "not_found" };

  const resolved = resolveLine(product, input.options, input.quantity);
  if (!resolved.ok) return { ok: false, error: { lineErrors: resolved.errors } };
  if (!(await uploadsOwnedBy(db, ownerKeyFor(owner), resolved.line.uploadIds))) {
    return { ok: false, error: "invalid_upload" };
  }

  const cart = await getOrCreateCart(db, owner);
  const lineKey = await lineKeyFor(product.id, resolved.line.selections);
  const [existing] = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.lineKey, lineKey)))
    .limit(1);

  if (existing) {
    const quantity = existing.quantity + input.quantity;
    const recheck = resolveLine(product, resolved.line.selections, quantity);
    if (!recheck.ok) return { ok: false, error: { lineErrors: recheck.errors } };
    await db.update(cartItems).set({ quantity }).where(eq(cartItems.id, existing.id));
    return { ok: true, itemId: existing.id };
  }

  const count = await db.$count(cartItems, eq(cartItems.cartId, cart.id));
  if (count >= MAX_CART_LINES) return { ok: false, error: "too_many_lines" };
  const [created] = await db
    .insert(cartItems)
    .values({ cartId: cart.id, productId: product.id, quantity: input.quantity, options: resolved.line.selections, lineKey })
    .returning({ id: cartItems.id });
  return { ok: true, itemId: created.id };
}

/** Fetches a cart line only if it belongs to this owner's cart (IDOR guard). */
async function ownedItem(db: Database, owner: CartOwner, itemId: string) {
  const cart = await findCart(db, owner);
  if (!cart) return null;
  const [item] = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id)))
    .limit(1);
  return item ?? null;
}

export async function updateCartItemQuantity(
  db: Database,
  owner: CartOwner,
  itemId: string,
  quantity: number,
): Promise<{ ok: true } | { ok: false; error: CartMutationError }> {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_LINE_QUANTITY) {
    return { ok: false, error: "invalid_quantity" };
  }
  const item = await ownedItem(db, owner, itemId);
  if (!item) return { ok: false, error: "not_found" };
  if (quantity === 0) {
    await db.delete(cartItems).where(eq(cartItems.id, item.id));
    return { ok: true };
  }
  const product = (await loadPricingProducts(db, [item.productId])).get(item.productId);
  if (!product) return { ok: false, error: "not_found" };
  const resolved = resolveLine(product, item.options, quantity);
  if (!resolved.ok) return { ok: false, error: { lineErrors: resolved.errors } };
  await db.update(cartItems).set({ quantity }).where(eq(cartItems.id, item.id));
  return { ok: true };
}

export async function removeCartItem(db: Database, owner: CartOwner, itemId: string) {
  const item = await ownedItem(db, owner, itemId);
  if (!item) return { ok: false as const, error: "not_found" as const };
  await db.delete(cartItems).where(eq(cartItems.id, item.id));
  return { ok: true as const };
}

/**
 * On sign-in, moves the anonymous visitor's cart lines into the user's cart
 * (merging identical lines) and re-owns their unattached uploads.
 */
export async function mergeVisitorCart(db: Database, visitorHash: string, userId: string) {
  const visitorCart = await findCart(db, { visitorHash });
  await db
    .update(uploads)
    .set({ ownerKey: `user:${userId}` })
    .where(and(eq(uploads.ownerKey, `visitor:${visitorHash}`), isNull(uploads.attachedId)));
  if (!visitorCart) return;
  const items = await db.select().from(cartItems).where(eq(cartItems.cartId, visitorCart.id));
  if (items.length > 0) {
    const userCart = await getOrCreateCart(db, { userId });
    const existing = await db.select().from(cartItems).where(eq(cartItems.cartId, userCart.id));
    const byKey = new Map(existing.map((e) => [e.lineKey, e]));
    for (const item of items) {
      const match = byKey.get(item.lineKey);
      if (match) {
        await db
          .update(cartItems)
          .set({ quantity: Math.min(MAX_LINE_QUANTITY, match.quantity + item.quantity) })
          .where(eq(cartItems.id, match.id));
      } else if (byKey.size < MAX_CART_LINES) {
        await db.insert(cartItems).values({
          cartId: userCart.id,
          productId: item.productId,
          quantity: item.quantity,
          options: item.options,
          lineKey: item.lineKey,
        });
        byKey.set(item.lineKey, item);
      }
    }
  }
  await db.delete(carts).where(eq(carts.id, visitorCart.id));
}
