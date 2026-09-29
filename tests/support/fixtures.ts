import type { Database } from "@/server/db/client";
import {
  categories,
  deliveryAreas,
  deliveryZones,
  discounts,
  productOptionValues,
  productOptions,
  products,
  users,
} from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export async function makeCategory(db: Database) {
  const [c] = await db.insert(categories).values({ slug: `cat-${uniq()}`, nameEn: "Cat", nameAr: "فئة" }).returning();
  return c;
}

export async function makeProduct(db: Database, overrides: Partial<typeof products.$inferInsert> = {}) {
  const cat = overrides.categoryId ? null : await makeCategory(db);
  const [p] = await db
    .insert(products)
    .values({
      slug: `prod-${uniq()}`,
      productType: "PHYSICAL",
      categoryId: cat?.id ?? overrides.categoryId!,
      nameEn: "Robot Arm Kit",
      nameAr: "ذراع روبوت",
      basePrice: 20_000,
      availability: "MADE_TO_ORDER",
      status: "PUBLISHED",
      ...overrides,
    })
    .returning();
  return p;
}

export async function makeCustomizableProduct(db: Database, overrides: Partial<typeof products.$inferInsert> = {}) {
  const p = await makeProduct(db, { productType: "CUSTOMIZABLE", ...overrides });
  const [color] = await db
    .insert(productOptions)
    .values({ productId: p.id, type: "SELECT", labelEn: "Color", labelAr: "اللون", isRequired: true })
    .returning();
  const [red, gold] = await db
    .insert(productOptionValues)
    .values([
      { optionId: color.id, labelEn: "Red", labelAr: "أحمر", priceDelta: 0 },
      { optionId: color.id, labelEn: "Gold", labelAr: "ذهبي", priceDelta: 3_000 },
    ])
    .returning();
  const [engraving] = await db
    .insert(productOptions)
    .values({ productId: p.id, type: "TEXT", labelEn: "Engraving", labelAr: "حفر", priceDelta: 2_000, maxValue: 20 })
    .returning();
  return { product: p, color, red, gold, engraving };
}

export async function makeZone(db: Database, overrides: Partial<typeof deliveryZones.$inferInsert> = {}) {
  const [z] = await db
    .insert(deliveryZones)
    .values({ code: `Z${uniq()}`, nameEn: "Baghdad", nameAr: "بغداد", fee: 5_000, ...overrides })
    .returning();
  return z;
}

export async function makeArea(db: Database, zoneId: string, fee: number) {
  const [a] = await db.insert(deliveryAreas).values({ zoneId, nameEn: `Area ${uniq()}`, nameAr: "منطقة", fee }).returning();
  return a;
}

export async function makeDiscount(db: Database, overrides: Partial<typeof discounts.$inferInsert> = {}) {
  const [d] = await db
    .insert(discounts)
    .values({ code: `SAVE${uniq().toUpperCase()}`, type: "PERCENT", value: 10, ...overrides })
    .returning();
  return d;
}

export async function makeUser(db: Database, phone?: string) {
  const [u] = await db
    .insert(users)
    .values({
      phone: phone ?? `+96477${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      name: "Test Customer",
      passwordHash: await hashPassword("password123"),
    })
    .returning();
  return u;
}

export function checkoutInput(zoneId: string, overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: crypto.randomUUID(),
    fullName: "Ali Hassan",
    phone: "0770 123 4567",
    zoneId,
    city: "Baghdad",
    district: "Karrada",
    addressLine: "Street 62, house 14",
    locale: "en",
    ...overrides,
  };
}
