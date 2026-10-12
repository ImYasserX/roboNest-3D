import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN, CUSTOMER } from "./fixtures";
import { BASE_URL } from "../playwright.config";

const PAGES = ["", "/products", "/products/rover-chassis-plate", "/products/planetary-gearbox-model", "/categories", "/custom-printing", "/cart", "/login", "/register", "/contact", "/faq", "/about", "/delivery", "/payment", "/returns", "/privacy", "/terms", "/admin/login"];

for (const locale of ["en", "ar"]) {
  for (const path of PAGES) {
    test(`axe: /${locale}${path}`, async ({ page }) => {
      await page.goto(`/${locale}${path}`);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    });
  }
}


test("axe: admin pages (Operations, light theme)", async ({ page }) => {
  await page.goto("/en/admin/login");
  await page.getByLabel("Username").fill(ADMIN.ops.username);
  await page.getByLabel("Password").fill(ADMIN.ops.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/admin$/);
  const problems: string[] = [];
  for (const path of ["", "/orders", "/products", "/products/new", "/categories", "/delivery", "/inventory", "/custom-requests", "/content", "/analytics", "/messages"]) {
    await page.goto(`/en/admin${path}`);
    await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    for (const v of r.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) problems.push(`${path}: ${v.id} ${v.nodes[0]?.target.join(" ")}`);
  }
  expect(problems).toEqual([]);
});

test("axe: customer account pages (ar)", async ({ page }) => {
  // Seeded customer with a verified phone (automated tests cannot receive SMS).
  await page.goto("/ar/login");
  await page.fill("#phone", CUSTOMER.phone);
  await page.fill("#password", CUSTOMER.password);
  await page.locator("main form button[type=submit]").click();
  await page.waitForURL(/\/ar\/account$/);
  const problems: string[] = [];
  for (const path of ["/account", "/account/orders", "/account/downloads", "/account/security", "/wishlist", "/checkout"]) {
    await page.goto(`/ar${path}`);
    await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    for (const v of r.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) problems.push(`${path}: ${v.id} ${v.nodes[0]?.target.join(" ")}`);
  }
  expect(problems).toEqual([]);
});

test("axe: storefront in the light theme", async ({ page, context }) => {
  await context.addCookies([{ name: "rn_theme", value: "light", url: BASE_URL }]);
  const problems: string[] = [];
  for (const path of ["/en", "/en/products", "/en/categories", "/en/contact", "/ar", "/ar/payment"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    for (const v of r.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) problems.push(`${path}: ${v.id} ${v.nodes[0]?.target.join(" ")}`);
  }
  expect(problems).toEqual([]);
});
