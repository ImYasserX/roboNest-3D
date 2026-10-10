import { expect, test } from "@playwright/test";

// Header, navigation, search, mobile menu direction, theme persistence and
// brand metadata, at the desktop and mobile widths from the brief.

/** Pairs of visible controls in the header that overlap each other (should be none). */
async function headerOverlaps(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll("header a, header button, header input")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("dialog");
    });
    const label = (el: Element) => el.getAttribute("aria-label") || el.textContent?.trim() || el.id || el.tagName;
    const out: string[] = [];
    els.forEach((a, i) =>
      els.slice(i + 1).forEach((b) => {
        if (a.contains(b) || b.contains(a)) return;
        // The search submit button sits inside the search field by design.
        if (a.closest("form[role=search]") && a.closest("form[role=search]") === b.closest("form[role=search]")) return;
        const r1 = a.getBoundingClientRect();
        const r2 = b.getBoundingClientRect();
        const overlap = r1.left < r2.right - 1 && r2.left < r1.right - 1 && r1.top < r2.bottom - 1 && r2.top < r1.bottom - 1;
        if (overlap) out.push(`${label(a)} × ${label(b)}`);
      }),
    );
    return out;
  });
}

for (const width of [1440, 1280, 1024]) {
  test(`desktop ${width}px: centred search, one "3D Models" entry, no tracking link`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/en");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "3D Models" })).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Shop" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "3D Models" })).toHaveAttribute("href", "/en/products");
    // Search box centred in the header (within 2 px).
    const search = await page.locator("#header-search").boundingBox();
    expect(search).not.toBeNull();
    const centre = search!.x + search!.width / 2;
    expect(Math.abs(centre - width / 2)).toBeLessThanOrEqual(2);
    // Header controls never overlap the search box.
    const actions = await page.locator('header a[href$="/cart"]').boundingBox();
    const logo = await page.locator('header a[aria-label="RoboNest.3D"]').boundingBox();
    expect(logo!.x + logo!.width).toBeLessThan(search!.x);
    expect(search!.x + search!.width).toBeLessThan(actions!.x);
    for (const locale of ["en", "ar"]) {
      await page.goto(`/${locale}`);
      expect(await headerOverlaps(page)).toEqual([]);
    }
  });
}

test("no public order-tracking link or page anywhere", async ({ page }) => {
  for (const locale of ["en", "ar"]) {
    await page.goto(`/${locale}`);
    await expect(page.locator('a[href*="/track"]')).toHaveCount(0);
    const res = await page.goto(`/${locale}/track`);
    expect(res?.status()).toBe(404);
  }
});

test("header search returns catalog results", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/en");
  await page.locator("#header-search").fill("gear");
  await page.locator("#header-search").press("Enter");
  await page.waitForURL(/\/en\/search\?q=gear/);
  await expect(page.getByRole("link", { name: /Spur Gear/ }).first()).toBeVisible();
});

for (const [locale, dir] of [["en", "ltr"], ["ar", "rtl"]] as const) {
  for (const width of [390, 360, 600]) {
    test(`mobile ${width}px (${locale}): menu opens from the hamburger's side and closes with Escape`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${locale}`);
      await expect(page.locator("html")).toHaveAttribute("dir", dir);
      expect(await headerOverlaps(page)).toEqual([]);
      const button = page.getByTestId("menu-button");
      const b = (await button.boundingBox())!;
      await button.click();
      const menu = page.getByTestId("mobile-menu");
      await expect(menu).toBeVisible();
      await page.waitForTimeout(250); // slide-in animation
      const m = (await menu.boundingBox())!;
      if (dir === "ltr") {
        expect(b.x).toBeLessThan(width / 2);
        expect(Math.round(m.x)).toBe(0);
      } else {
        expect(b.x + b.width).toBeGreaterThan(width / 2);
        expect(Math.round(m.x + m.width)).toBe(width);
      }
      expect(m.width).toBeLessThanOrEqual(width);
      await expect(menu.getByRole("link", { name: locale === "en" ? "3D Models" : "مجسمات 3D" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(button).toBeFocused();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}

test("theme choice persists across reloads without a flash of the other theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/en");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  const toggle = page.getByRole("button", { name: /^Theme: System/ });
  await toggle.click(); // system → light
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(247, 246, 251)");
  await page.reload();
  // Rendered by the server from the cookie, so it is correct before any script runs.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /^Theme: Light/ }).click(); // light → dark
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /^Theme: Dark/ }).click(); // dark → system
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("system preference picks the light theme when no choice is saved", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/en");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(247, 246, 251)");
});

test("favicon, icons and manifest are served from the brand mark", async ({ page, request }) => {
  await page.goto("/en");
  const title = await page.title();
  expect(title).toContain("RoboNest.3D");
  for (const path of ["/favicon.ico", "/icon.png", "/apple-icon.png", "/manifest.webmanifest", "/brand/icon-512.png"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("RoboNest.3D");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", /icon|favicon/);
});

test("footer policy links resolve and show the confirmed contact details", async ({ page }) => {
  await page.goto("/en");
  const footer = page.locator("footer");
  await expect(footer.getByText("support@robonest.tech")).toBeVisible();
  await expect(footer.getByText("0751-891-1112")).toBeVisible();
  await expect(footer.getByText("0751-546-9566")).toBeVisible();
  await expect(footer.getByText(/9:00 AM to 9:00 PM/)).toBeVisible();
  for (const path of ["/delivery", "/payment", "/returns", "/privacy", "/terms", "/faq", "/contact", "/about"]) {
    const res = await page.goto(`/en${path}`);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  await page.goto("/en/payment");
  await expect(page.getByText(/more than 50,000\sIQD/).first()).toBeVisible();
});

test("contact form validates on the server and never reports success when email is not configured", async ({ page }) => {
  await page.goto("/en/contact");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Please check the highlighted fields|That was very quick/).first()).toBeVisible();
  await page.waitForTimeout(3_200); // human fill time
  await page.getByLabel("Your name").fill("E2E Visitor");
  await page.getByLabel("Your email").fill("visitor@example.com");
  await page.getByLabel("Subject").fill("Quote for brackets");
  await page.getByRole("textbox", { name: "Message" }).fill("Hello, I would like a quote for ten brackets.");
  await page.getByRole("button", { name: "Send message" }).click();
  // The test environment has no Resend credentials: the visitor sees a failure, not "sent".
  await expect(page.getByText(/could not be sent right now/)).toBeVisible();
  await expect(page.getByText(/Your message was sent/)).toHaveCount(0);
});

test("categories page uses real data and links to filtered listings", async ({ page }) => {
  await page.goto("/en/categories");
  await page.getByRole("link", { name: /3D Prints/ }).first().click();
  await page.waitForURL(/\/en\/categories\/3d-prints$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("3D Prints");
});
