import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";
import { adminLogin } from "./fixtures";
import { BASE_URL } from "../playwright.config";

// One Owner sign-in for the whole file (admin sign-in is rate limited per IP,
// and TOTP codes are single use); every test gets a page with that session.
let storage: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>> | undefined;
const test = base.extend<{ owner: Page }>({
  owner: async ({ browser }, provide) => {
    if (!storage) {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await adminLogin(p, "owner");
      storage = await ctx.storageState();
      await ctx.close();
    }
    const ctx = await browser.newContext({ storageState: storage });
    await provide(await ctx.newPage());
    await ctx.close();
  },
});

// The redesigned admin: bulk product management with a review step, the
// delete consequences dialog, the digital files tabs, mobile layout and
// accessibility of the new pages. Uses seeded products no other spec relies on.
test.describe.configure({ mode: "serial" });

test("bulk edit: select, review the exact change, apply; other fields stay as they were", async ({ owner: page }) => {
  await page.goto("/en/admin/products?q=headphone");
  const row = page.locator('[data-product-row="headphone-stand"]');
  await expect(row).toBeVisible();
  const priceBefore = await row.locator("td").nth(5).innerText();
  await row.getByRole("checkbox").check();
  const toolbar = page.getByTestId("bulk-toolbar");
  await expect(toolbar).toContainText("1 product selected");
  await toolbar.getByRole("button", { name: "Edit selected" }).click();
  await expect(page.getByRole("dialog", { name: /Edit 1 product/ })).toBeVisible();
  const dialog = page.locator("dialog[open]"); // its title changes on the review step
  await expect(dialog.getByRole("button", { name: "Review changes" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /Change Add tags/ }).check();
  await dialog.getByRole("textbox", { name: "Add tags (comma separated)" }).fill("e2e-bulk, desk");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByTestId("bulk-review")).toContainText("Add tags (comma separated): e2e-bulk, desk");
  await expect(dialog).toContainText("All other fields, images, files, options and 3D previews stay unchanged.");
  await dialog.getByRole("button", { name: "Apply to 1 product" }).click();
  await expect(page.getByTestId("bulk-notice")).toHaveText(/Updated 1, unchanged 0\./);
  // Price and status untouched; the tag is searchable.
  await page.goto("/en/admin/products?q=e2e-bulk");
  await expect(page.locator('[data-product-row="headphone-stand"] td').nth(5)).toHaveText(priceBefore);
  await expect(page.locator('[data-product-row="headphone-stand"]')).toContainText("Published");
  await page.goto("/en/admin/audit-log?action=product.bulk_updated");
  await expect(page.getByText("product.bulk_updated").first()).toBeVisible();
});

test("select all on the page, then all matching across pages; the delete dialog explains consequences", async ({ owner: page }) => {
  await page.goto("/en/admin/products");
  await page.getByRole("checkbox", { name: "Select all on this page" }).first().check();
  const toolbar = page.getByTestId("bulk-toolbar");
  await expect(toolbar).toBeVisible();
  // 17 seeded products fit on one page: no cross-page banner.
  await expect(page.getByTestId("select-all-matching")).toHaveCount(0);
  await page.goto("/en/admin/products?q=cable");
  await page.locator('[data-product-row="cable-clips-10-pack"]').getByRole("checkbox").check();
  await page.getByTestId("bulk-toolbar").getByRole("button", { name: "Delete selected" }).click();
  const dialog = page.getByRole("dialog", { name: /Delete 1 product/ });
  await expect(dialog).toContainText("will be deleted permanently (never ordered)");
  await expect(dialog).toContainText("Order history, payments and audit logs are never deleted");
  const confirm = dialog.getByRole("button", { name: /Delete or archive/ });
  await expect(confirm).toBeDisabled();
  await page.getByTestId("bulk-delete-confirm").fill("delete");
  await expect(confirm).toBeDisabled(); // must be exactly DELETE
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-product-row="cable-clips-10-pack"]')).toBeVisible(); // nothing deleted
});

test("digital files: paid originals and preview proxies are separate tabs; statuses and buyers shown", async ({ owner: page }) => {
  await page.goto("/en/admin/digital-files");
  await expect(page.getByRole("link", { name: "Paid files (private)" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("planetary-gearbox-model.stl")).toBeVisible();
  const table = page.locator("table tbody");
  await expect(table.getByText("Private").first()).toBeVisible();
  await expect(table.getByText("Active (buyers can download)").first()).toBeVisible();
  // No storage key or public URL of a paid file appears anywhere on the page.
  expect(await page.content()).not.toMatch(/digital\/\d{4}\/\d{2}\//);
  await page.getByRole("link", { name: "3D previews (public proxies)" }).click();
  await expect(page.getByText("Preview proxies are reduced, unit-sized meshes")).toBeVisible();
  await expect(page.getByText("Planetary Gearbox").first()).toBeVisible();
});

test("dashboard shows payment and preview work; the admin works at phone width", async ({ owner: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/admin");
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByText("Payments to verify")).toBeVisible();
  await expect(page.getByText("Outstanding deposits")).toBeVisible();
  for (const path of ["/admin", "/admin/products", "/admin/payments", "/admin/digital-files", "/admin/orders"]) {
    await page.goto(`/en${path}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
  }
  // The menu opens on phones.
  await page.getByText("Open admin menu").click();
  await expect(page.getByRole("link", { name: "Payments" }).first()).toBeVisible();
});

for (const [locale, theme] of [["en", "dark"], ["ar", "light"]] as const) {
  test(`axe: redesigned admin pages as Owner (${locale}, ${theme})`, async ({ owner: page }) => {
    await page.context().addCookies([{ name: "rn_theme", value: theme, url: BASE_URL }]);
    const problems: string[] = [];
    for (const path of ["", "/products", "/payments", "/payments?view=history", "/digital-files", "/digital-files?tab=previews", "/orders"]) {
      await page.goto(`/${locale}/admin${path}`);
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      for (const v of r.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) problems.push(`${path}: ${v.id} ${v.nodes[0]?.target.join(" ")}`);
    }
    expect(problems).toEqual([]);
  });
}
