import { defineConfig, devices } from "@playwright/test";

// E2E runs against a freshly seeded, separate local database (E2E_STATE). By default it starts the
// production Worker bundle in workerd (`wrangler dev`), the same runtime as
// Cloudflare. Set E2E_BASE_URL to test an already running server instead.
//   npm run cf:build && npm run test:e2e
const PORT = 8787;
/**
 * E2E has its own local state folder, so running the suite never wipes the
 * data in your normal local database (.wrangler/state). Only E2E_BASE_URL
 * (a server you started yourself) falls back to reseeding the default state.
 */
export const E2E_STATE = ".wrangler/e2e-state";
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: BASE_URL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    // Safety gate: every test project depends on it, so nothing runs if the
    // server could reach real providers.
    { name: "outbound-safety", testMatch: /outbound-safety\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["outbound-safety"] },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // OUTBOUND_INTEGRATIONS=disabled: E2E can never email, message the
        // owners, send SMS or call payment providers, even though wrangler
        // dev loads .dev.vars (which may contain real tokens). Never reuse a
        // server started by hand: it would not have the kill switch.
        // Migrations first: Playwright starts this server before globalSetup seeds.
        command: `npx wrangler d1 migrations apply robonest-3d --local --persist-to ${E2E_STATE} && npx wrangler dev --port ${PORT} --ip 127.0.0.1 --persist-to ${E2E_STATE} --var OUTBOUND_INTEGRATIONS:disabled`,
        url: `${BASE_URL}/ar`,
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
