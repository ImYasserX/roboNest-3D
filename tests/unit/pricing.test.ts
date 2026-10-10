import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  computeTotals,
  evaluateDiscount,
  resolveDeliveryFee,
  resolveLine,
  type DiscountRule,
  type PricingProduct,
} from "@/lib/pricing";

const COLOR = "11111111-1111-4111-8111-111111111111";
const RED = "22222222-2222-4222-8222-222222222222";
const GOLD = "33333333-3333-4333-8333-333333333333";
const SIZE = "44444444-4444-4444-8444-444444444444";
const ENGRAVE = "55555555-5555-4555-8555-555555555555";
const EXTRAS = "66666666-6666-4666-8666-666666666666";
const STAND = "77777777-7777-4777-8777-777777777777";
const CASE = "88888888-8888-4888-8888-888888888888";
const FILE = "99999999-9999-4999-8999-999999999999";
const GIFT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPLOAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function product(overrides: Partial<PricingProduct> = {}): PricingProduct {
  return {
    id: "p1",
    productType: "CUSTOMIZABLE",
    status: "PUBLISHED",
    availability: "MADE_TO_ORDER",
    stockQuantity: null,
    basePrice: 20_000,
    salePrice: null,
    options: [
      {
        id: COLOR, type: "SELECT", labelEn: "Color", labelAr: "اللون", isRequired: true,
        priceDelta: 0, pricePerUnit: 0, minValue: null, maxValue: null, unitEn: "", unitAr: "",
        values: [
          { id: RED, labelEn: "Red", labelAr: "أحمر", priceDelta: 0, isActive: true },
          { id: GOLD, labelEn: "Silk gold", labelAr: "ذهبي", priceDelta: 3_000, isActive: true },
        ],
      },
      {
        id: SIZE, type: "NUMBER", labelEn: "Height", labelAr: "الارتفاع", isRequired: false,
        priceDelta: 0, pricePerUnit: 250, minValue: 100, maxValue: 200, unitEn: "mm", unitAr: "ملم", values: [],
      },
      {
        id: ENGRAVE, type: "TEXT", labelEn: "Engraving", labelAr: "حفر", isRequired: false,
        priceDelta: 2_000, pricePerUnit: 0, minValue: null, maxValue: 20, unitEn: "", unitAr: "", values: [],
      },
      {
        id: EXTRAS, type: "CHECKBOX", labelEn: "Extras", labelAr: "إضافات", isRequired: false,
        priceDelta: 0, pricePerUnit: 0, minValue: null, maxValue: null, unitEn: "", unitAr: "",
        values: [
          { id: STAND, labelEn: "Stand", labelAr: "قاعدة", priceDelta: 1_500, isActive: true },
          { id: CASE, labelEn: "Case", labelAr: "علبة", priceDelta: 4_000, isActive: false },
        ],
      },
      {
        id: GIFT, type: "CHECKBOX", labelEn: "Gift wrap", labelAr: "تغليف هدية", isRequired: false,
        priceDelta: 1_000, pricePerUnit: 0, minValue: null, maxValue: null, unitEn: "", unitAr: "", values: [],
      },
      {
        id: FILE, type: "FILE", labelEn: "Logo", labelAr: "شعار", isRequired: false,
        priceDelta: 5_000, pricePerUnit: 0, minValue: null, maxValue: null, unitEn: "", unitAr: "", values: [],
      },
    ],
    ...overrides,
  };
}

describe("resolveLine", () => {
  it("prices base + every kind of option on the server", () => {
    const r = resolveLine(product(), {
      [COLOR]: GOLD, [SIZE]: 140, [ENGRAVE]: "  Yasser  ", [EXTRAS]: [STAND], [GIFT]: true, [FILE]: UPLOAD,
    }, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 20000 + 3000 + 250*(140-100) + 2000 + 1500 + 1000 + 5000
    expect(r.line.unitPrice).toBe(42_500);
    expect(r.line.lineTotal).toBe(85_000);
    expect(r.line.selections[ENGRAVE]).toBe("Yasser");
    expect(r.line.uploadIds).toEqual([UPLOAD]);
  });

  it("uses the sale price only when it is lower than the base price", () => {
    const sale = resolveLine(product({ salePrice: 15_000 }), { [COLOR]: RED }, 1);
    const bogus = resolveLine(product({ salePrice: 25_000 }), { [COLOR]: RED }, 1);
    expect(sale.ok && sale.line.unitPrice).toBe(15_000);
    expect(bogus.ok && bogus.line.unitPrice).toBe(20_000);
  });

  it("rejects missing required options, unknown options and foreign value ids", () => {
    expect(resolveLine(product(), {}, 1)).toMatchObject({ ok: false, errors: [{ code: "required", optionId: COLOR }] });
    const unknown = resolveLine(product(), { [COLOR]: RED, hacked: "1" }, 1);
    expect(unknown.ok).toBe(false);
    expect(resolveLine(product(), { [COLOR]: STAND }, 1).ok).toBe(false);
  });

  it("rejects inactive values, duplicate checkbox values and out-of-range numbers", () => {
    expect(resolveLine(product(), { [COLOR]: RED, [EXTRAS]: [CASE] }, 1).ok).toBe(false);
    expect(resolveLine(product(), { [COLOR]: RED, [EXTRAS]: [STAND, STAND] }, 1).ok).toBe(false);
    expect(resolveLine(product(), { [COLOR]: RED, [SIZE]: 99 }, 1)).toMatchObject({ ok: false, errors: [{ code: "out_of_range" }] });
    expect(resolveLine(product(), { [COLOR]: RED, [SIZE]: 150.5 }, 1).ok).toBe(false);
    expect(resolveLine(product(), { [COLOR]: RED, [SIZE]: -1e9 }, 1).ok).toBe(false);
  });

  it("rejects negative, fractional, zero and huge quantities", () => {
    for (const q of [0, -1, 1.5, 101, "2", Number.NaN]) {
      expect(resolveLine(product(), { [COLOR]: RED }, q)).toMatchObject({ ok: false, errors: [{ code: "invalid_quantity" }] });
    }
  });

  it("validates text length and control characters", () => {
    expect(resolveLine(product(), { [COLOR]: RED, [ENGRAVE]: "x".repeat(21) }, 1)).toMatchObject({ ok: false, errors: [{ code: "too_long" }] });
    expect(resolveLine(product(), { [COLOR]: RED, [ENGRAVE]: "a\u0000b" }, 1).ok).toBe(false);
    expect(resolveLine(product(), { [COLOR]: RED, [FILE]: "../../etc/passwd" }, 1).ok).toBe(false);
  });

  it("does not let physical stock block made-to-order products", () => {
    expect(resolveLine(product({ availability: "MADE_TO_ORDER", stockQuantity: 0 }), { [COLOR]: RED }, 5).ok).toBe(true);
    expect(resolveLine(product({ availability: "IN_STOCK", stockQuantity: 0 }), { [COLOR]: RED }, 1)).toMatchObject({ ok: false, errors: [{ code: "out_of_stock" }] });
    expect(resolveLine(product({ availability: "IN_STOCK", stockQuantity: 2 }), { [COLOR]: RED }, 3)).toMatchObject({ ok: false, errors: [{ code: "insufficient_stock" }] });
    expect(resolveLine(product({ status: "DRAFT" }), { [COLOR]: RED }, 1).ok).toBe(false);
  });

  it("produces identical canonical selections for equivalent input", () => {
    const a = resolveLine(product(), { [EXTRAS]: [STAND], [COLOR]: RED }, 1);
    const b = resolveLine(product(), { [COLOR]: RED, [EXTRAS]: [STAND] }, 1);
    expect(a.ok && b.ok && canonicalJson(a.line.selections) === canonicalJson(b.line.selections)).toBe(true);
  });
});

describe("evaluateDiscount", () => {
  const base: DiscountRule = {
    id: "d", code: "WELCOME", type: "PERCENT", value: 10, minSubtotal: 0, maxDiscount: null,
    maxUses: null, usedCount: 0, startsAt: null, endsAt: null, isActive: true,
  };
  it("computes percent discounts with integer flooring and caps", () => {
    expect(evaluateDiscount(base, 33_333)).toEqual({ ok: true, amount: 3_333 });
    expect(evaluateDiscount({ ...base, maxDiscount: 2_000 }, 33_333)).toEqual({ ok: true, amount: 2_000 });
  });
  it("never discounts more than the subtotal", () => {
    expect(evaluateDiscount({ ...base, type: "FIXED", value: 50_000 }, 10_000)).toEqual({ ok: true, amount: 10_000 });
  });
  it("enforces activity, dates, usage and minimum subtotal", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(evaluateDiscount({ ...base, isActive: false }, 1000, now)).toEqual({ ok: false, error: "invalid" });
    expect(evaluateDiscount({ ...base, startsAt: new Date("2026-07-01") }, 1000, now)).toEqual({ ok: false, error: "not_started" });
    expect(evaluateDiscount({ ...base, endsAt: new Date("2026-05-01") }, 1000, now)).toEqual({ ok: false, error: "expired" });
    expect(evaluateDiscount({ ...base, maxUses: 3, usedCount: 3 }, 1000, now)).toEqual({ ok: false, error: "exhausted" });
    expect(evaluateDiscount({ ...base, minSubtotal: 5000 }, 1000, now)).toEqual({ ok: false, error: "min_subtotal" });
    expect(evaluateDiscount(null, 1000)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("delivery and totals", () => {
  const zone = { id: "z", fee: 5_000, isActive: true };
  it("charges the flat 5,000 IQD everywhere and ignores legacy per-zone/area fees", () => {
    expect(resolveDeliveryFee({ ...zone, fee: 9_000 } as typeof zone, null)).toEqual({ ok: true, fee: 5_000 });
    expect(resolveDeliveryFee(zone, { id: "a", zoneId: "z", fee: 3_000, isActive: true } as { id: string; zoneId: string; isActive: boolean })).toEqual({ ok: true, fee: 5_000 });
  });
  it("rejects inactive zones and areas from another governorate", () => {
    expect(resolveDeliveryFee({ ...zone, isActive: false }, null)).toEqual({ ok: false, error: "zone_unavailable" });
    expect(resolveDeliveryFee(zone, { id: "a", zoneId: "other", isActive: true })).toEqual({ ok: false, error: "area_unavailable" });
  });
  it("computes deterministic integer totals", () => {
    expect(computeTotals([10_000, 25_500], 3_550, 5_000)).toEqual({ subtotal: 35_500, discountTotal: 3_550, deliveryFee: 5_000, total: 36_950 });
    expect(computeTotals([1_000], 9_999, 0)).toEqual({ subtotal: 1_000, discountTotal: 1_000, deliveryFee: 0, total: 0 });
  });
});
