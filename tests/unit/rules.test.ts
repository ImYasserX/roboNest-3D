import { describe, expect, it } from "vitest";
import { allowedOrderTransitions, canAdminTransitionCustomRequest, canTransitionOrder } from "@/lib/order-status";
import { hasPermission, PERMISSIONS, roleRequiresTotp } from "@/lib/permissions";
import { formatIraqiPhone, normalizeIraqiPhone } from "@/lib/phone";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { escapeLike, normalizeSearchText } from "@/lib/search-normalize";
import { formatIQD } from "@/lib/money";

describe("order status transitions", () => {
  it("follows the production and delivery pipeline", () => {
    expect(canTransitionOrder("PENDING", "CONFIRMED", { hasPhysical: true })).toBe(true);
    expect(canTransitionOrder("PENDING", "DELIVERED", { hasPhysical: true })).toBe(false);
    expect(canTransitionOrder("OUT_FOR_DELIVERY", "DELIVERED", { hasPhysical: true })).toBe(true);
    expect(canTransitionOrder("DELIVERED", "PENDING", { hasPhysical: true })).toBe(false);
    expect(allowedOrderTransitions("CANCELLED", { hasPhysical: true })).toEqual([]);
    expect(allowedOrderTransitions("RETURNED", { hasPhysical: true })).toEqual([]);
  });
  it("lets digital-only orders complete without shipping, but not physical ones", () => {
    expect(canTransitionOrder("CONFIRMED", "DELIVERED", { hasPhysical: false })).toBe(true);
    expect(canTransitionOrder("CONFIRMED", "DELIVERED", { hasPhysical: true })).toBe(false);
    expect(canTransitionOrder("CONFIRMED", "IN_PRODUCTION", { hasPhysical: false })).toBe(false);
  });
  it("restricts admin custom-request transitions", () => {
    expect(canAdminTransitionCustomRequest("SUBMITTED", "QUOTED")).toBe(true);
    expect(canAdminTransitionCustomRequest("SUBMITTED", "ACCEPTED")).toBe(false);
    expect(canAdminTransitionCustomRequest("REJECTED", "QUOTED")).toBe(false);
  });
});

describe("permissions", () => {
  it("grants the super admin everything", () => {
    for (const p of PERMISSIONS) expect(hasPermission("SUPER_ADMIN", p)).toBe(true);
  });
  it("denies operations admins sensitive capabilities", () => {
    for (const p of ["admins.manage", "settings.edit", "audit.view", "products.delete", "customers.delete", "categories.delete", "discounts.manage", "analytics.profit"] as const) {
      expect(hasPermission("OPERATIONS", p)).toBe(false);
    }
    for (const p of ["orders.update", "products.edit", "delivery.edit", "customRequests.manage", "customers.view"] as const) {
      expect(hasPermission("OPERATIONS", p)).toBe(true);
    }
  });
  it("fails closed for unknown roles", () => {
    expect(hasPermission("HACKER" as never, "orders.view")).toBe(false);
  });
  it("requires TOTP for super admins", () => {
    expect(roleRequiresTotp("SUPER_ADMIN")).toBe(true);
    expect(roleRequiresTotp("OPERATIONS")).toBe(false);
  });
});

describe("Iraqi phone numbers", () => {
  it("normalizes local, international and Arabic-Indic forms", () => {
    for (const input of ["07701234567", "0770 123 4567", "+9647701234567", "009647701234567", "٠٧٧٠١٢٣٤٥٦٧", "7701234567"]) {
      expect(normalizeIraqiPhone(input)).toBe("+9647701234567");
    }
  });
  it("rejects landlines, foreign and malformed numbers", () => {
    for (const input of ["", "0770123456", "077012345678", "+15551234567", "07101234567", "abc", "+964770123456x"]) {
      expect(normalizeIraqiPhone(input)).toBeNull();
    }
  });
  it("formats for display", () => {
    expect(formatIraqiPhone("+9647701234567")).toBe("0770 123 4567");
  });
});

describe("safe redirects", () => {
  it("allows only same-site relative paths", () => {
    expect(safeRedirectPath("/en/account?x=1", "/")).toBe("/en/account?x=1");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/%0d%0a", "\\\\evil", "/a\nb", 42]) {
      expect(safeRedirectPath(bad, "/fallback")).toMatch(/^\/(fallback|%0d%0a)$/);
    }
  });
});

describe("search normalization", () => {
  it("folds Arabic letter variants, diacritics and case", () => {
    expect(normalizeSearchText("أُرجُوحة")).toBe(normalizeSearchText("ارجوحه"));
    expect(normalizeSearchText("Robot ARM!")).toBe("robot arm");
  });
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_\\")).toBe("100\\%\\_\\\\");
  });
});

describe("money formatting", () => {
  it("formats whole dinars without decimals", () => {
    expect(formatIQD(25000, "en")).toBe("25,000\u00a0IQD");
    expect(formatIQD(25000, "ar")).toBe("25,000\u00a0د.ع");
  });
});
