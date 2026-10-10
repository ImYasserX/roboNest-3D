import { expect, test, type Page } from "@playwright/test";
import { ADMIN, CUSTOMER, totp } from "./fixtures";

// The end-to-end journey, in order. Each step builds on the previous one, so
// the file runs serially. The guest order is above 50,000 IQD, so it goes
// through the deposit workflow; the customer order is a standard order.
test.describe.configure({ mode: "serial" });

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
    await page.waitForURL(/\/en\/admin$/, { timeout: 8_000 }).catch(() => undefined);
    if (/\/en\/admin$/.test(page.url())) return;
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  }
  throw new Error("TOTP sign-in failed");
}

async function fillAddress(page: Page) {
  await page.getByLabel("Governorate").selectOption({ label: "Erbil" });
  await page.getByLabel("City / town").fill("Erbil");
  await page.getByLabel("District / neighbourhood (mahalla)").fill("Ankawa");
  await page.getByLabel("Street and house details").fill("Street 40, house 12");
}

test("guest 74,000 IQD order: blocked until an owner configures deposits, then awaiting deposit with flat delivery", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "3D Models" }).click();
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

  await page.goto("/en/cart");
  await expect(page.getByText("74,000 IQD").first()).toBeVisible();
  await expect(page.getByText("Delivery (flat fee)")).toBeVisible();
  await expect(page.getByText(/need a deposit of 30% of the products total/)).toBeVisible();
  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await expect(page.getByText("Orders of this size cannot be placed online yet")).toBeVisible();
  await page.getByLabel("Full name").fill("Guest Buyer");
  await page.getByLabel("Mobile number").fill("0770 999 8877");
  await fillAddress(page);
  await page.getByRole("button", { name: "Place order" }).click();
  // The server refuses too: the browser cannot bypass the deposit rule.
  await expect(page.locator("#checkout-error")).toContainText("Orders of this size need a deposit");
  await expect(page).toHaveURL(/\/en\/checkout$/);

  // An owner configures deposits in a separate browser session; the guest keeps the cart.
  const ownerContext = await page.context().browser()!.newContext();
  const ownerPage = await ownerContext.newPage();
  await adminLogin(ownerPage);
  await ownerPage.goto("/en/admin/payments");
  await expect(ownerPage.getByText("Deposits cannot be paid: high-value orders are blocked")).toBeVisible();
  // A Super Admin cannot change the owners' approval of the manual fallback.
  await expect(ownerPage.locator("#manualApproved")).toBeDisabled();
  await expect(ownerPage.getByText(/Approved by E2E test fixture/)).toBeVisible();
  await ownerPage.locator("#FIB_enabled").check();
  await ownerPage.locator("#FIB_en").fill("FIB account RoboNest.3D, number 0000 (test)");
  await ownerPage.locator("#FIB_ar").fill("حساب FIB باسم RoboNest.3D، رقم 0000 (تجربة)");
  await ownerPage.getByRole("button", { name: "Save changes" }).click();
  await expect(ownerPage.getByText("Saved.").first()).toBeVisible();
  await expect(ownerPage.getByText("Deposits cannot be paid: high-value orders are blocked")).toHaveCount(0);
  await ownerContext.close();

  // Now the guest can place the high-value order.
  await page.goto("/en/checkout");
  await page.getByLabel("Full name").fill("Guest Buyer");
  await page.getByLabel("Mobile number").fill("0770 999 8877");
  await fillAddress(page);
  const summary = page.locator("#checkout-summary").locator("..");
  await expect(summary).toContainText("5,000 IQD");
  await expect(summary).toContainText("79,000 IQD");
  await expect(summary).toContainText("22,200 IQD"); // 30% of the 74,000 products total; delivery excluded
  await expect(summary).toContainText("56,800 IQD"); // balance on delivery
  await page.getByRole("button", { name: "Place order" }).dblclick();
  await page.waitForURL(/\/en\/orders\/RN-/);
  await expect(page.getByText("Thank you! Your order is placed.")).toBeVisible();
  orderNumber = (await page.getByRole("heading", { level: 1 }).innerText()).replace("Order ", "").trim();
  orderUrl = page.url();
  expect(orderNumber).toMatch(/^RN-\d{6}-[A-Z0-9]{6}$/);
  await expect(page.getByText("Current status: Awaiting deposit")).toBeVisible();
  await expect(page.getByText("FIB account RoboNest.3D, number 0000 (test)")).toBeVisible();
  await page.getByLabel("Transaction reference").fill("FIB-TEST-12345");
  await page.getByRole("button", { name: "Send transfer details" }).click();
  await expect(page.getByText(/We received your transfer details/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Current status: Deposit being checked")).toBeVisible();
  // No public lookup: without the link token and not signed in, the order is hidden.
  const anonymous = await page.context().browser()!.newPage();
  await anonymous.goto(`/en/orders/${orderNumber}`);
  await expect(anonymous.getByText("Order not found")).toBeVisible();
  await anonymous.close();
});

test("registration is unavailable without an SMS provider; seeded verified customer orders and sees only their orders", async ({ page }) => {
  await page.goto("/en/register");
  await expect(page.getByText("Registration is not available yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);

  await page.goto("/en/login");
  await page.getByLabel("Mobile number").fill(CUSTOMER.phone);
  await page.getByLabel("Password").fill(CUSTOMER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/account$/);
  await page.goto("/en/products/servo-bracket-mg996r");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to your cart.")).toBeVisible();
  await page.goto("/en/checkout");
  await expect(page.getByLabel("Full name")).toHaveValue(CUSTOMER.name);
  await page.getByLabel("Governorate").selectOption({ label: "Baghdad" });
  await page.getByLabel("Area").selectOption({ label: "Karkh" });
  await page.getByLabel("City / town").fill("Baghdad");
  await page.getByLabel("District / neighbourhood (mahalla)").fill("Mansour");
  await page.getByLabel("Street and house details").fill("Street 14");
  // 4,500 + 5,000 flat delivery, well under the deposit threshold.
  await expect(page.locator("#checkout-summary").locator("..")).toContainText("9,500 IQD");
  await expect(page.getByText("A deposit is required for this order")).toHaveCount(0);
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/orders\/RN-/);
  await expect(page.getByText("Current status: Received")).toBeVisible();
  const mine = (await page.getByRole("heading", { level: 1 }).innerText()).replace("Order ", "").trim();
  await page.goto("/en/account/orders");
  await expect(page.getByText(mine)).toBeVisible();
  await expect(page.getByText(orderNumber)).toHaveCount(0);
  // Another customer's order is not viewable through the account route.
  await page.goto(`/en/account/orders/${orderNumber}`);
  await expect(page.getByText("Page not found")).toBeVisible();
  await page.goto("/en/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/en$/);
  await expect(page.locator('header a[href$="/login"]:visible')).toHaveCount(1);
});

test("admin signs in with TOTP and edits a product price", async ({ page }) => {
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

test("admin verifies the deposit, then moves the order through production; the guest sees it", async ({ page, browser }) => {
  await adminLogin(page);
  await page.goto(`/en/admin/orders?q=${orderNumber}`);
  await page.getByRole("link", { name: orderNumber }).click();
  // Before verification the only generic transition is cancellation.
  await expect(page.locator("#to option")).toHaveText(["Cancelled"]);
  await expect(page.getByText("FIB-TEST-12345")).toBeVisible();
  // Verifying requires typing the amount seen in the provider account.
  await page.getByRole("button", { name: "Verify deposit" }).click();
  await expect(page.getByText(/must equal the required deposit exactly/)).toBeVisible();
  await page.getByLabel("Amount received (IQD)").fill("22200");
  await page.getByRole("button", { name: "Verify deposit" }).click();
  await expect(page.getByText("Verified", { exact: true }).first()).toBeVisible();
  for (const next of ["Confirmed", "Printing", "Quality check", "Ready for delivery", "Out for delivery"]) {
    await page.getByLabel("Move to").selectOption({ label: next });
    if (next === "Out for delivery") await page.getByLabel("Message to customer").fill("Courier will call before arriving.");
    await page.getByRole("button", { name: "Update status" }).click();
    // Wait for the refreshed form: the status just applied is no longer offered.
    await expect(page.locator("#to option").filter({ hasText: new RegExp(`^${next}$`) })).toHaveCount(0);
  }
  await page.goto("/en/admin/audit-log?action=order.deposit.verified");
  await expect(page.getByText("order.deposit.verified").first()).toBeVisible();
  // Telegram is not configured in tests: the alert waits, the order is unaffected.
  await page.goto("/en/admin/notifications");
  await expect(page.getByText("Telegram is not configured", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: orderNumber }).first()).toBeVisible();

  const guest = await browser.newPage();
  await guest.goto(orderUrl);
  await expect(guest.getByText("Current status: Out for delivery")).toBeVisible();
  await expect(guest.getByText(/Your deposit of 22,200\sIQD was received and verified/)).toBeVisible();
  await expect(guest.getByText("Courier will call before arriving.")).toBeVisible();
  await guest.close();
});

test("operations admin cannot reach owner / Super Admin areas", async ({ page }) => {
  await page.goto("/en/admin/login");
  await page.getByLabel("Username").fill(ADMIN.ops.username);
  await page.getByLabel("Password").fill(ADMIN.ops.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/admin$/);
  await expect(page.getByRole("link", { name: "Admin users" })).toHaveCount(0);
  for (const path of ["admins", "audit-log", "settings", "discounts", "payments", "notifications"]) {
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ترس مستقيم، موديول 1");
});
