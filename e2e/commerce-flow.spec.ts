import { expect, test, type Page } from "@playwright/test";
import { ADMIN, CUSTOMER, adminLogin } from "./fixtures";

// The end-to-end journey, in order. Each step builds on the previous one, so
// the file runs serially. The guest order is above 50,000 IQD, so it goes
// through the deposit workflow; the customer order is a standard order.
test.describe.configure({ mode: "serial" });

let orderNumber = "";
let orderUrl = "";

async function fillAddress(page: Page) {
  await page.getByLabel("Governorate").selectOption({ label: "Erbil" });
  await page.getByLabel("City / town").fill("Erbil");
  await page.getByLabel("District / neighbourhood (mahalla)").fill("Ankawa");
  await page.getByLabel("Street and house details").fill("Street 40, house 12");
}

test("guest 74,000 IQD order: awaiting a WhatsApp deposit with flat delivery; opening WhatsApp changes nothing", async ({ page }) => {
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
  // Deposits are always payable now (manual WhatsApp payment), so the order can be placed.
  await expect(page.getByText("A deposit is required for this order")).toBeVisible();
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

  // The manual payment step: reference, amount from the order, purpose, WhatsApp.
  const step = page.getByTestId("payment-step");
  await expect(step).toContainText(orderNumber);
  await expect(step.getByTestId("amount-due")).toHaveText(/22,200\sIQD/);
  await expect(step).toContainText("Upfront deposit (30%)");
  const wa = step.getByTestId("whatsapp-payment");
  const href = (await wa.getAttribute("href"))!;
  expect(href.startsWith("https://wa.me/9647518911112?text=")).toBe(true);
  const text = decodeURIComponent(href.split("?text=")[1]);
  expect(text).toBe(`Hello RoboNest.3D, I would like to confirm the deposit for order ${orderNumber}. Amount: 22,200 IQD.`);
  expect(text).not.toMatch(/0770|Guest Buyer|t=|token/i); // no personal data or link token
  await expect(wa).toHaveAttribute("target", "_blank");
  await expect(wa).toHaveAttribute("rel", /noopener/);
  // Opening WhatsApp changes nothing: the deposit is still awaited after a reload.
  const popup = page.waitForEvent("popup").catch(() => null);
  await wa.click();
  await (await popup)?.close();
  await page.reload();
  await expect(page.getByText("Current status: Awaiting deposit")).toBeVisible();
  await expect(page.getByTestId("amount-due")).toHaveText(/22,200\sIQD/);
  // The retired reference form and online-payment buttons are gone.
  await expect(page.getByLabel("Transaction reference")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pay with FIB|I have paid/ })).toHaveCount(0);
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
  await page.getByRole("link", { name: "Calibration Cube Set", exact: true }).click();
  await page.getByLabel("Base price (IQD)").fill("6000");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.goto("/en/products/calibration-cube-set");
  await expect(page.getByText("6,000 IQD").first()).toBeVisible();
  await page.goto("/en/admin/audit-log?action=product.price.changed");
  await expect(page.getByText("product.price.changed").first()).toBeVisible();
});

test("a Super Admin can see but not confirm payments", async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/en/admin/orders?q=${orderNumber}`);
  await page.getByRole("link", { name: orderNumber }).click();
  const panel = page.getByTestId("payment-panel");
  await expect(panel).toContainText("Only an Owner can confirm");
  await expect(panel.getByRole("button", { name: "Confirm payment" })).toHaveCount(0);
  await page.goto("/en/admin/payments");
  await expect(page.getByText("Only an Owner can confirm, dispute or refund payments")).toBeVisible();
  await expect(page.getByRole("link", { name: orderNumber })).toBeVisible();
  await expect(page.getByTestId(`confirm-payment-${orderNumber}`)).toHaveCount(0);
});

test("the Owner confirms the deposit, then the order moves through production; the guest sees it", async ({ page, browser }) => {
  await adminLogin(page, "owner");
  await page.goto(`/en/admin/payments?view=awaiting`);
  await expect(page.getByRole("link", { name: orderNumber })).toBeVisible();
  await page.goto(`/en/admin/orders?q=${orderNumber}`);
  await page.getByRole("link", { name: orderNumber }).click();
  // Before verification the only generic transition is cancellation.
  await expect(page.locator("#to option")).toHaveText(["Cancelled"]);
  const panel = page.getByTestId("payment-panel");
  await panel.getByTestId(`confirm-payment-${orderNumber}`).click();
  const dialog = page.getByRole("dialog", { name: "Confirm that this payment was received" });
  await expect(dialog).toContainText(orderNumber);
  await expect(dialog).toContainText(/22,200\sIQD/);
  await expect(dialog).toContainText("Upfront deposit");
  // A wrong amount is refused; the amount must match what the order says is due.
  await dialog.getByLabel("Amount received (IQD)").fill("20000");
  await dialog.getByLabel("I checked that this money actually arrived.").check();
  await dialog.getByRole("button", { name: /Confirm .* received/ }).click();
  await expect(dialog.getByText(/must be exactly the amount due/)).toBeVisible();
  await dialog.getByLabel("Amount received (IQD)").fill("22200");
  await dialog.getByLabel("What you checked").fill("FIB transfer seen in the account (E2E)");
  await dialog.getByRole("button", { name: /Confirm .* received/ }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText("Confirmed", { exact: true }).first()).toBeVisible();
  await expect(panel).toContainText("FIB transfer seen in the account (E2E)");
  for (const next of ["Confirmed", "Printing", "Quality check", "Ready for delivery", "Out for delivery"]) {
    await page.getByLabel("Move to").selectOption({ label: next });
    if (next === "Out for delivery") await page.getByLabel("Message to customer").fill("Courier will call before arriving.");
    await page.getByRole("button", { name: "Update status" }).click();
    // Wait for the refreshed form: the status just applied is no longer offered.
    await expect(page.locator("#to option").filter({ hasText: new RegExp(`^${next}$`) })).toHaveCount(0);
  }
  // The deposit never marks the whole order paid.
  await expect(panel).toContainText("Awaiting payment");
  await page.goto("/en/admin/audit-log?action=payment.deposit.confirmed");
  await expect(page.getByText("payment.deposit.confirmed").first()).toBeVisible();
  await page.goto("/en/admin/payments?view=history");
  await expect(page.getByRole("link", { name: orderNumber })).toBeVisible();
  await expect(page.getByText("E2E test owner").first()).toBeVisible();

  const guest = await browser.newPage();
  await guest.goto(orderUrl);
  await expect(guest.getByText("Current status: Out for delivery")).toBeVisible();
  await expect(guest.getByText(/Your deposit of 22,200\sIQD was received and verified by our team/)).toBeVisible();
  await expect(guest.getByText("Courier will call before arriving.")).toBeVisible();
  // The balance is still open (cash on delivery, or WhatsApp in advance).
  await expect(guest.getByTestId("amount-due")).toHaveText(/56,800\sIQD/);
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
