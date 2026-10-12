import { describe, expect, it } from "vitest";
import { DEPOSIT_RATE_PERCENT, DEPOSIT_THRESHOLD_IQD, FLAT_DELIVERY_FEE_IQD, depositAmountFor, depositBase, requiresDeposit, resolveDepositTerms, type DepositConfig } from "@/lib/payment-rules";
import { allowedOrderTransitions, canTransitionOrder } from "@/lib/order-status";
import { canManageAdmin, hasPermission, roleRequiresTotp } from "@/lib/permissions";
import { DEFAULT_THEME, THEMES, nextTheme, parseTheme } from "@/lib/theme";

const payable: DepositConfig = { onlineAvailable: false, manualAvailable: true };
const unpayable: DepositConfig = { onlineAvailable: false, manualAvailable: false };

describe("delivery and deposit rules", () => {
  it("uses a flat 5,000 IQD delivery fee, a 50,000 IQD threshold and a 30% rate", () => {
    expect(FLAT_DELIVERY_FEE_IQD).toBe(5_000);
    expect(DEPOSIT_THRESHOLD_IQD).toBe(50_000);
    expect(DEPOSIT_RATE_PERCENT).toBe(30);
  });

  it("requires a deposit only when the amount is STRICTLY greater than 50,000", () => {
    expect(requiresDeposit(49_999)).toBe(false);
    expect(requiresDeposit(50_000)).toBe(false);
    expect(requiresDeposit(50_001)).toBe(true);
  });

  it("is exactly 30% of the discounted products subtotal, rounded down, delivery excluded", () => {
    expect(depositAmountFor(50_000)).toBe(0);
    expect(depositAmountFor(50_001)).toBe(15_000); // 15,000.3
    expect(depositAmountFor(50_003)).toBe(15_000); // 15,000.9
    expect(depositAmountFor(50_004)).toBe(15_001); // 15,001.2
    expect(depositAmountFor(60_000)).toBe(18_000);
    expect(depositAmountFor(100_000_000)).toBe(30_000_000); // integer-safe at the price cap
    expect(depositAmountFor(depositBase(70_000, 15_000))).toBe(16_500);
    expect(depositAmountFor(depositBase(60_000, 10_000))).toBe(0); // discounted to exactly 50,000
  });

  it("measures goods after discount, excluding delivery", () => {
    expect(depositBase(55_000, 5_000)).toBe(50_000);
    expect(requiresDeposit(depositBase(55_000, 5_000))).toBe(false);
    expect(requiresDeposit(depositBase(55_000, 4_999))).toBe(true);
    expect(depositBase(1_000, 5_000)).toBe(0);
  });

  it("never lets a high-value order bypass the deposit when it cannot be paid", () => {
    expect(resolveDepositTerms(unpayable, 50_001)).toEqual({ required: true, amount: 15_000, error: "deposit_unconfigured" });
    expect(resolveDepositTerms(unpayable, 50_000)).toEqual({ required: false, amount: 0 });
    expect(resolveDepositTerms(payable, 60_000)).toEqual({ required: true, amount: 18_000 });
    expect(resolveDepositTerms({ onlineAvailable: true, manualAvailable: false }, 60_000)).toEqual({ required: true, amount: 18_000 });
  });
});

describe("order state machine with deposits", () => {
  it("cannot skip deposit verification through the generic status change", () => {
    expect(allowedOrderTransitions("AWAITING_DEPOSIT", { hasPhysical: true })).toEqual(["CANCELLED"]);
    expect(allowedOrderTransitions("DEPOSIT_SUBMITTED", { hasPhysical: true })).toEqual(["CANCELLED"]);
    expect(canTransitionOrder("AWAITING_DEPOSIT", "CONFIRMED", { hasPhysical: true })).toBe(false);
    expect(canTransitionOrder("DEPOSIT_SUBMITTED", "DEPOSIT_VERIFIED", { hasPhysical: true })).toBe(false);
    expect(canTransitionOrder("DEPOSIT_VERIFIED", "CONFIRMED", { hasPhysical: true })).toBe(true);
    expect(canTransitionOrder("PENDING", "DEPOSIT_VERIFIED", { hasPhysical: true })).toBe(false);
    expect(canTransitionOrder("DELIVERED", "PENDING", { hasPhysical: true })).toBe(false);
  });
});

describe("owner role", () => {
  it("has every permission, requires TOTP, and is only managed by another owner", () => {
    for (const p of ["payments.manage", "payments.verify", "notifications.manage", "admins.manage", "audit.view"] as const) expect(hasPermission("OWNER", p)).toBe(true);
    // Payment verification is Owner-only (SUPER_ADMIN_MAY_VERIFY_PAYMENTS = false).
    expect(hasPermission("SUPER_ADMIN", "payments.verify")).toBe(false);
    expect(hasPermission("SUPER_ADMIN", "payments.manage")).toBe(true);
    expect(hasPermission("OPERATIONS", "payments.verify")).toBe(false);
    expect(hasPermission("OPERATIONS", "payments.manage")).toBe(false);
    expect(hasPermission("OPERATIONS", "notifications.manage")).toBe(false);
    expect(roleRequiresTotp("OWNER")).toBe(true);
    expect(canManageAdmin("SUPER_ADMIN", "OWNER")).toBe(false);
    expect(canManageAdmin("OWNER", "OWNER")).toBe(true);
    expect(canManageAdmin("SUPER_ADMIN", "OPERATIONS")).toBe(true);
    expect(canManageAdmin("OPERATIONS", "OPERATIONS")).toBe(false);
  });
});

describe("theme preference", () => {
  it("has exactly Light and Dark, defaults to Dark, and maps legacy or invalid cookies to Dark", () => {
    expect(THEMES).toEqual(["light", "dark"]);
    expect(DEFAULT_THEME).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("dark");
    expect(parseTheme("<script>")).toBe("dark");
    expect(parseTheme(undefined)).toBe("dark");
    expect([nextTheme("light"), nextTheme("dark")]).toEqual(["dark", "light"]);
  });
});
