import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { runBatch } from "@/server/db/client";
import { categories, products } from "@/server/db/schema";
import { startPlatform, type TestPlatform } from "../support/platform";

// Guards the assumptions checkout relies on: a D1 batch is atomic, and CHECK
// constraints abort the whole batch.
let p: TestPlatform;
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

describe("D1 semantics", () => {
  it("rolls back an entire batch when a CHECK constraint fails", async () => {
    const [cat] = await p.db.insert(categories).values({ slug: "c", nameEn: "C", nameAr: "ج" }).returning();
    const [prod] = await p.db
      .insert(products)
      .values({ slug: "p", productType: "PHYSICAL", categoryId: cat.id, nameEn: "P", nameAr: "ب", basePrice: 1000, availability: "IN_STOCK", stockQuantity: 1 })
      .returning();

    await expect(
      runBatch(p.db, [
        p.db.update(products).set({ nameEn: "changed" }).where(eq(products.id, prod.id)),
        p.db.update(products).set({ stockQuantity: sql`${products.stockQuantity} - 2` }).where(eq(products.id, prod.id)),
      ]),
    ).rejects.toThrow();

    const [after] = await p.db.select().from(products).where(eq(products.id, prod.id));
    expect(after.nameEn).toBe("P");
    expect(after.stockQuantity).toBe(1);
  });
});
