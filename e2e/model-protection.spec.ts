import { expect, test, type Response } from "@playwright/test";

import { execFileSync } from "node:child_process";
import { inspectProxyGlb, sha256Hex } from "../src/server/preview/proxy";
import { E2E_STATE } from "../playwright.config";

// What the browser actually receives on a product page with a 3D preview.
// These checks inspect real network responses from the production Worker
// bundle; they cannot prove that no other page leaks, so the HTTP probes
// below test the storage routes directly as well.
const PREVIEW_URL = /\/api\/previews\/[0-9a-f-]{36}$/;
const OTHER_MODEL_URL = /\.(glb|gltf|stl|obj|3mf|zip)(\?|$)|\/media\/(previews|preview-proxies|digital|uploads)\//i;
const MODEL_TYPE = /^model\/|application\/(octet-stream|zip)|gltf/i;

/** Reads the E2E database (never your normal local data). */
function query<T>(sql: string): T[] {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "robonest-3d", "--local", "--persist-to", E2E_STATE, "--json", "--command", sql], { encoding: "utf8" });
  return JSON.parse(out)[0].results as T[];
}

for (const slug of ["planetary-gearbox-model", "robonest-bot-figurine"]) {
  test(`paid model page loads only the approved, reduced preview proxy (${slug})`, async ({ page }) => {
    const responses: Response[] = [];
    const cspErrors: string[] = [];
    page.on("response", (r) => responses.push(r));
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) cspErrors.push(m.text());
    });
    await page.goto(`/en/products/${slug}`);
    // Nothing 3D is fetched until the visitor asks.
    expect(responses.some((r) => PREVIEW_URL.test(r.url()))).toBe(false);
    await page.getByRole("button", { name: "3D view" }).click();
    const viewer = page.getByTestId("model-viewer");
    await viewer.getByRole("button", { name: "Load 3D preview" }).click();
    await expect(viewer.getByRole("button", { name: "Reset view" })).toBeVisible({ timeout: 30_000 });

    // Rotate by dragging and with the keyboard; zoom with the buttons; reset.
    const canvas = viewer.locator("model-viewer");
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("PageUp");
    await viewer.getByRole("button", { name: "Zoom in" }).click();
    await viewer.getByRole("button", { name: "Zoom out" }).click();
    await viewer.getByRole("button", { name: "Stop rotating" }).click();
    await expect(viewer.getByRole("button", { name: "Rotate" })).toHaveAttribute("aria-pressed", "false");
    await viewer.getByRole("button", { name: "Reset view" }).click();
    await page.waitForTimeout(500);

    // Exactly one model response: the approved proxy, from /api/previews/<id>.
    const models = responses.filter((r) => PREVIEW_URL.test(r.url()) || MODEL_TYPE.test(r.headers()["content-type"] ?? ""));
    expect(models.map((r) => new URL(r.url()).pathname)).toHaveLength(1);
    const [proxy] = models;
    expect(proxy.url()).toMatch(PREVIEW_URL);
    expect(proxy.status()).toBe(200);
    expect(proxy.headers()["content-type"]).toBe("model/gltf-binary");
    expect(proxy.headers()["cache-control"]).toBe("private, no-cache");
    for (const r of responses) expect(r.url(), "no other model URL is requested").not.toMatch(OTHER_MODEL_URL);

    // The bytes are the approved proxy and differ from the paid original.
    const bytes = new Uint8Array(await proxy.body());
    const check = inspectProxyGlb(bytes);
    expect(check.ok, check.reasons.join(",")).toBe(true);
    const previewId = new URL(proxy.url()).pathname.split("/").pop()!;
    const [row] = query<{ sha256: string; status: string; triangle_count: number; product_id: string }>(`SELECT sha256, status, triangle_count, product_id FROM preview_models WHERE id = '${previewId}'`);
    expect(row.status).toBe("APPROVED");
    expect(await sha256Hex(bytes)).toBe(row.sha256);
    const originals = query<{ sha256: string; triangle_count: number }>(`SELECT sha256, triangle_count FROM digital_files WHERE product_id = '${row.product_id}'`);
    expect(originals.length).toBeGreaterThan(0);
    for (const o of originals) {
      expect(o.sha256).not.toBe(row.sha256);
      expect(check.triangles).toBeLessThanOrEqual(o.triangle_count * 0.5);
    }
    expect(check.extent).toBeLessThanOrEqual(1.0001); // unit size, not millimetres

    // Neither the HTML nor the RSC payload names a storage key.
    const html = await page.content();
    expect(html).not.toMatch(/preview-proxies\/|previews\/\d{4}\/\d{2}\/|digital\/\d{4}\/\d{2}\//);
    for (const r of responses.filter((x) => /text\/(html|x-component|plain)|json/.test(x.headers()["content-type"] ?? ""))) {
      const body = await r.text().catch(() => "");
      expect(body, r.url()).not.toMatch(/preview-proxies\/\d{4}|previews\/\d{4}\/\d{2}\/[0-9a-f-]{36}|digital\/\d{4}\/\d{2}\/[0-9a-f-]{36}/);
    }
    expect(cspErrors).toEqual([]);
  });
}

test("Arabic, phone-sized, touch: the viewer loads, is labelled in Arabic and keeps page scrolling", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto("/ar/products/low-poly-dragon-egg");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "عرض ثلاثي الأبعاد" }).tap();
  const viewer = page.getByTestId("model-viewer");
  await viewer.getByRole("button", { name: "تحميل المعاينة ثلاثية الأبعاد" }).tap();
  await expect(viewer.getByRole("button", { name: "إعادة ضبط العرض" })).toBeVisible({ timeout: 30_000 });
  const canvas = viewer.locator("model-viewer");
  // React sets src/alt as element properties (model-viewer labels its canvas from alt).
  expect(await canvas.evaluate((el) => (el as HTMLElement & { alt: string }).alt)).toMatch(/معاينة تفاعلية/);
  await expect(canvas).toHaveAttribute("touch-action", "pan-y");
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await context.close();
});

test("a product without an approved preview shows no 3D control and requests no model", async ({ page }) => {
  const responses: Response[] = [];
  page.on("response", (r) => responses.push(r));
  await page.goto("/en/products/parametric-knob-6mm"); // a paid model with no approved preview
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.getByRole("button", { name: "3D view" }).count()).toBe(0);
  expect(await page.getByTestId("model-viewer").count()).toBe(0);
  for (const r of responses) {
    expect(r.url()).not.toMatch(PREVIEW_URL);
    expect(r.headers()["content-type"] ?? "").not.toMatch(MODEL_TYPE);
  }
});

test("storage routes refuse model files, private keys and anonymous downloads", async ({ request }) => {
  const id = "11111111-2222-4333-8444-555555555555";
  const [live] = query<{ id: string; r2_key: string }>("SELECT id, r2_key FROM preview_models WHERE status = 'APPROVED' LIMIT 1");
  const [paid] = query<{ id: string }>("SELECT id FROM digital_files LIMIT 1");
  for (const path of [
    `/media/previews/2026/10/${id}.glb`,
    `/media/products/2026/10/${id}.glb`,
    `/media/digital/2026/10/${id}.stl`,
    `/media/uploads/2026/10/${id}.stl`,
    `/media/${live.r2_key}`, // the approved proxy is not served by key
    `/media/products/..%2Fdigital/${id}.stl`,
    `/api/previews/${id}`, // unknown id
    `/api/previews/${paid.id}`, // a paid file's id
    `/api/previews/..%2F..%2Fdigital`,
    `/api/previews/${encodeURIComponent(live.r2_key)}`,
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  expect((await request.get(`/api/previews/${live.id}`)).status()).toBe(200);
  // The admin review copy needs an admin session.
  expect((await request.get(`/api/admin/previews/${live.id}`)).status()).toBe(401);
  const download = await request.get(`/api/downloads/${id}/${id}`, { maxRedirects: 0 });
  expect(download.status()).toBe(303);
  expect(download.headers()["location"]).toMatch(/\/login\?next=/);
});

test("the content security policy no longer allows WebAssembly evaluation", async ({ request }) => {
  const csp = (await request.get("/en")).headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).not.toContain("wasm-unsafe-eval");
});

for (const [locale, width] of [["en", 1280], ["ar", 1280], ["en", 390], ["ar", 390]] as const) {
  test(`WhatsApp buttons open a chat with 0751-891-1112 (${locale}, ${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["", "/contact", "/about", "/forgot-password"]) {
      await page.goto(`/${locale}${path}`);
      const links = page.locator('a[href*="wa.me"]');
      expect(await links.count(), `${path} has a WhatsApp link`).toBeGreaterThan(0);
      for (const href of await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")))) {
        expect(href).toMatch(/^https:\/\/wa\.me\/9647518911112(\?text=.*)?$/);
      }
      const first = links.first();
      await expect(first).toHaveAttribute("target", "_blank");
      await expect(first).toHaveAttribute("rel", /noopener/);
      await expect(first).toHaveAttribute("aria-label", /0751-891-1112/);
    }
    // No other WhatsApp destination anywhere on these pages.
    await page.goto(`/${locale}/contact`);
    expect(await page.locator('a[href^="https://wa.me/"]:not([href^="https://wa.me/9647518911112"])').count()).toBe(0);
  });
}

for (const locale of ["en", "ar"] as const) {
  test(`About and Terms render in the store's design, with a working table of contents (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/about`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    expect(await page.getByRole("heading", { level: 2 }).count()).toBeGreaterThanOrEqual(3);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${locale}/terms`);
    const toc = page.getByRole("navigation", { name: locale === "en" ? "On this page" : "بهذي الصفحة" });
    const links = toc.locator('div.hidden a[href^="#section-"]');
    expect(await links.count()).toBe(9);
    await links.nth(4).click();
    await expect(page).toHaveURL(/#section-5$/);
    await expect(page.locator("#section-5")).toBeInViewport();
  });
}
