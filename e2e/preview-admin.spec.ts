import { expect, test } from "@playwright/test";
import { ADMIN, adminLogin } from "./fixtures";

// Admin flow for interactive previews: generate a proxy from the paid file,
// review it in 3D, approve it (Super Admin), see it on the storefront, then
// withdraw it. Operations staff can generate but not approve.
test.describe.configure({ mode: "serial" });

const SLUG = "parametric-knob-6mm"; // a paid model seeded WITHOUT a preview

async function openProductAdmin(page: import("@playwright/test").Page) {
  await page.goto(`/en/admin/products?q=knob`);
  await page.getByRole("link", { name: /Parametric knob/i }).first().click();
  await expect(page.getByRole("heading", { name: "3D preview" })).toBeVisible();
}

test("Super Admin generates, reviews, approves and withdraws a preview", async ({ page, request }) => {
  await adminLogin(page);
  await openProductAdmin(page);
  await page.getByLabel("Detail").selectOption("low");
  await page.getByRole("button", { name: "Generate preview" }).click();
  await expect(page.getByText("Preview generated.")).toBeVisible();
  const candidate = page.locator('[data-preview-status="PENDING_REVIEW"]').first();
  await expect(candidate).toBeVisible();

  // Pending: not public.
  await candidate.getByText("Review in 3D").click();
  await candidate.getByRole("button", { name: "Load 3D preview" }).click();
  await expect(candidate.getByRole("button", { name: "Reset view" })).toBeVisible({ timeout: 30_000 });
  const src = await candidate.locator("model-viewer").evaluate((el) => new URL((el as HTMLElement & { src: string }).src, location.href).pathname);
  expect(src).toMatch(/^\/api\/admin\/previews\/[0-9a-f-]{36}$/);
  const id = src!.split("/").pop()!;
  expect((await request.get(`/api/previews/${id}`)).status()).toBe(404);

  await candidate.getByRole("button", { name: "Approve and publish" }).click();
  await expect(page.locator(`[data-preview-status="APPROVED"]`)).toBeVisible();
  expect((await request.get(`/api/previews/${id}`)).status()).toBe(200);
  await page.goto(`/en/products/${SLUG}`);
  await expect(page.getByRole("button", { name: "3D view" })).toBeVisible();

  await openProductAdmin(page);
  await page.locator('[data-preview-status="APPROVED"]').getByRole("button", { name: "Withdraw from storefront" }).click();
  await expect(page.locator('[data-preview-status="APPROVED"]')).toHaveCount(0);
  expect((await request.get(`/api/previews/${id}`)).status()).toBe(404);

  await page.goto("/en/admin/audit-log?action=preview.approved");
  await expect(page.getByText("preview.approved").first()).toBeVisible();
});

test("Operations staff cannot approve previews", async ({ page }) => {
  await page.goto("/en/admin/login");
  await page.getByLabel("Username").fill(ADMIN.ops.username);
  await page.getByLabel("Password").fill(ADMIN.ops.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/admin$/);
  await openProductAdmin(page);
  await expect(page.getByRole("button", { name: "Generate preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and publish" })).toHaveCount(0);
});
