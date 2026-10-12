import { expect, test } from "@playwright/test";

const WIDTHS = [375, 390, 768, 1024, 1440];
const PAGES = ["", "/products", "/products/rover-chassis-plate", "/products/planetary-gearbox-model", "/cart", "/custom-printing", "/checkout", "/delivery", "/about", "/terms"];

// Fails on any horizontal page overflow; saves screenshots for manual review.
for (const locale of ["ar", "en"]) {
  for (const width of WIDTHS) {
    test(`no horizontal overflow at ${width}px (${locale})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // Put something in the cart so /checkout renders the form.
      await page.goto(`/${locale}/products/servo-bracket-mg996r`);
      await page.locator("main form button[type=submit]").first().click();
      await page.waitForTimeout(800);
      for (const path of PAGES) {
        await page.goto(`/${locale}${path}`);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${locale}${path} at ${width}px overflows by ${overflow}px`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `e2e/.artifacts/${locale}-${width}${path.replace(/\//g, "_") || "_home"}.png`, fullPage: true });
      }
    });
  }
}
