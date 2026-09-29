import { expect, test, type Page } from "@playwright/test";
import { ADMIN, totp } from "./fixtures";

// The end-to-end journey from the project brief, in order. Each step builds
// on the previous one, so the file runs serially.
test.describe.configure({ mode: "serial" });

const customer = { name: "E2E Customer", phone: "0790 111 2233", password: "e2e-customer-pass" };
let orderNumber = "";
let orderUrl = "";

async function adminLogin(page: Page) {
  await page.goto("/en/admin/login");
  await page.getByLabel("Username").fill(ADMIN.super.username);
  await page.getByLabel("Password").fill(ADMIN.super.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/verify/);
  // Codes are single-use (replay protection): if this 30 s step's code was
  // already used by an earlier test, wait for the next step, like a person would.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel("Authentication code").fill(totp(ADMIN.super.totpSecret));
    await page.getByRole("button", { name: "Verify" }).click();
    // The previous attempt's error may still be on screen, so judge by URL.
    await page.waitForURL(/\/en\/admin$/, { timeout: 8_000 }).catch(() => undefined);
    if (/\/en\/admin$/.test(page.url())) return;
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  }
  throw new Error("TOTP sign-in failed");
}

test("1-6: guest browses, customizes, and places a COD order", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Shop" }).click();
  await page.waitForURL(/\/en\/products$/);
  await page.getByRole("link", { name: "Robot Rover Chassis Plate" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Robot Rover Chassis Plate" })).toBeVisible();

  await page.getByLabel("Colour").selectOption({ label: "Silk gold (+2,000 IQD)" });
  await page.getByLabel(/PETG \(stronger\)/).check();
  await page.getByLabel(/Engraving text/).fill("Team Babylon");
  await page.getByLabel("Increase quantity").click();
  // (28,000 + 2,000 + 4,000 + 3,000) × 2
  await expect(page.getByText("Total: 74,000 IQD")).toBeVisible();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to your cart.")).toBeVisible();
  await expect(page.locator('header a[href$="/cart"]')).toHaveAttribute("aria-label", "Cart, 2 items");

  // 4-6: guest checkout with cash on delivery and confirmation.
  await page.goto("/en/cart");
  await expect(page.getByText("74,000 IQD").first()).toBeVisible();
  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await page.getByLabel("Full name").fill("Guest Buyer");
  await page.getByLabel("Mobile number").fill("0770 999 8877");
  await page.getByLabel("Governorate").selectOption({ label: "Erbil — 6,000 IQD" });
  await page.getByLabel("City / town").fill("Erbil");
  await page.getByLabel("District / neighbourhood (mahalla)").fill("Ankawa");
  await page.getByLabel("Street and house details").fill("Street 40, house 12");
  await page.getByLabel("Nearest landmark").fill("Near the park");
  await expect(page.locator("#checkout-summary").locator("..")).toContainText("80,000 IQD");
  await expect(page.getByText("Cash on delivery (COD)")).toBeVisible();
  await page.getByRole("button", { name: "Place order" }).dblclick();
  await page.waitForURL(/\/en\/orders\/RN-/);
  await expect(page.getByText("Thank you! Your order is placed.")).toBeVisible();
  orderNumber = (await page.getByRole("heading", { level: 1 }).innerText()).replace("Order ", "").trim();
  orderUrl = page.url();
  expect(orderNumber).toMatch(/^RN-\d{6}-[A-Z0-9]{6}$/);
  await expect(page.getByText("Total to pay on delivery")).toBeVisible();
  await expect(page.locator('header a[href$="/cart"]')).toHaveAttribute("aria-label", "Cart, empty");
});


test("guest order can be tracked by number + phone, not by guessing", async ({ page }) => {
  await page.goto("/en/track");
  await page.getByLabel("Order number").fill(orderNumber);
  await page.getByLabel("Mobile number").fill("0770 000 0000");
  await page.getByRole("button", { name: "Track order" }).click();
  await expect(page.getByText("We couldn't find an order with those details.")).toBeVisible();
  await page.getByLabel("Mobile number").fill("07709998877");
  await page.getByRole("button", { name: "Track order" }).click();
  await page.waitForURL(new RegExp(`/orders/${orderNumber}`));
  await page.goto(`/en/orders/${orderNumber}`); // no token, not signed in
  await expect(page.getByText("Order not found")).toBeVisible();
});

test("7-8: customer registers, orders, and sees the order in the account", async ({ page }) => {
  await page.goto("/en/register");
  await page.getByLabel("Full name").fill(customer.name);
  await page.getByLabel("Mobile number").fill(customer.phone);
  await page.getByLabel("Password").fill(customer.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/en\/account$/);
  await page.goto("/en/products/servo-bracket-mg996r");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to your cart.")).toBeVisible();
  await page.goto("/en/checkout");
  await expect(page.getByLabel("Full name")).toHaveValue(customer.name);
  await page.getByLabel("Governorate").selectOption({ label: "Baghdad — 5,000 IQD" });
  await page.getByLabel("Area").selectOption({ label: "Karkh — 5,000 IQD" });
  await page.getByLabel("City / town").fill("Baghdad");
  await page.getByLabel("District / neighbourhood (mahalla)").fill("Mansour");
  await page.getByLabel("Street and house details").fill("Street 14");
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/orders\/RN-/);
  const mine = (await page.getByRole("heading", { level: 1 }).innerText()).replace("Order ", "").trim();
  await page.goto("/en/account/orders");
  await expect(page.getByText(mine)).toBeVisible();
  // Another customer's order is not viewable through the account route.
  await page.goto(`/en/account/orders/${orderNumber}`);
  await expect(page.getByText("Page not found")).toBeVisible();
  // Sign in again (logout → login) to prove the password works.
  await page.goto("/en/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/en$/);
  await expect(page.locator('header a[href$="/login"]:visible')).toHaveCount(1);
  await page.goto("/en/login");
  await page.getByLabel("Mobile number").fill(customer.phone);
  await page.getByLabel("Password").fill(customer.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/account$/);
});

test("9-10: admin signs in with TOTP and edits a product price", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/en/admin/products?q=calibration");
  await page.getByRole("link", { name: "Calibration Cube Set" }).click();
  await page.getByLabel("Base price (IQD)").fill("6000");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.goto("/en/products/calibration-cube-set");
  await expect(page.getByText("6,000 IQD").first()).toBeVisible();
  await page.goto("/en/admin/audit-log?action=product.price.changed");
  await expect(page.getByText("product.price.changed").first()).toBeVisible();
});

test("11-12: admin moves the order through production and the customer sees it", async ({ page, browser }) => {
  await adminLogin(page);
  await page.goto(`/en/admin/orders?q=${orderNumber}`);
  await page.getByRole("link", { name: orderNumber }).click();
  for (const next of ["Confirmed", "Printing", "Quality check", "Ready for delivery", "Out for delivery"]) {
    await page.getByLabel("Move to").selectOption({ label: next });
    if (next === "Out for delivery") await page.getByLabel("Message to customer").fill("Courier will call before arriving.");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  }
  const guest = await browser.newPage();
  await guest.goto(orderUrl);
  await expect(guest.getByText("Current status: Out for delivery")).toBeVisible();
  await expect(guest.getByText("Courier will call before arriving.")).toBeVisible();
  await guest.close();
});

test("operations admin cannot reach Super Admin areas", async ({ page }) => {
  await page.goto("/en/admin/login");
  await page.getByLabel("Username").fill(ADMIN.ops.username);
  await page.getByLabel("Password").fill(ADMIN.ops.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/admin$/);
  await expect(page.getByRole("link", { name: "Admin users" })).toHaveCount(0);
  for (const path of ["admins", "audit-log", "settings", "discounts"]) {
    await page.goto(`/en/admin/${path}`);
    await expect(page).toHaveURL(/\/admin\/forbidden$/);
  }
});

test("language switch keeps the page and flips to RTL", async ({ page }) => {
  await page.goto("/en/products/spur-gear-module-1");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("link", { name: "Switch to Arabic" }).first().click();
  await page.waitForURL(/\/ar\/products\/spur-gear-module-1/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar-IQ");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ترس مستقيم — موديول 1");
});
