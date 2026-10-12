import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BUSINESS, businessWhatsappUrl } from "@/lib/business";
import { DEFAULT_SETTINGS } from "@/server/services/settings";

const en = readFileSync("messages/en.json", "utf8");
const ar = readFileSync("messages/ar.json", "utf8");

describe("customer-facing claims", () => {
  it("advertises no resin printing (only the explicit 'we do not offer resin printing' statement remains)", () => {
    const negations = ["We do not offer resin printing.", "ما نقدم طباعة بالريزن."];
    for (const [text, words] of [[en, /resin|\bSLA\b|\bMSLA\b|\bDLP\b/gi], [ar, /ريزن|راتنج/g]] as const) {
      const cleaned = negations.reduce((t, n) => t.split(n).join(""), text);
      expect(cleaned.match(words) ?? []).toEqual([]);
    }
    expect(DEFAULT_SETTINGS.customPrint.materials.map((m) => m.code)).not.toContain("RESIN");
  });
});

describe("WhatsApp contact", () => {
  it("uses the official click-to-chat URL for 0751-891-1112 (digits only, country code, no leading 0)", () => {
    expect(BUSINESS.whatsapp.display).toBe("0751-891-1112");
    expect(businessWhatsappUrl()).toBe("https://wa.me/9647518911112");
    expect(businessWhatsappUrl("Hello RoboNest.3D")).toBe("https://wa.me/9647518911112?text=Hello%20RoboNest.3D");
    expect(businessWhatsappUrl()).not.toMatch(/^tel:/);
  });
});
