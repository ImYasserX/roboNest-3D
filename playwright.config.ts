import { defineConfig, devices } from "@playwright/test";

// E2E runs against a freshly seeded local database. By default it starts the
// production Worker bundle in workerd (`wrangler dev`) — the same runtime as
// Cloudflare. Set E2E_BASE_URL to test an already running server instead.
//   npm run cf:build && npm run test:e2e
const PORT = 8787;
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1`, url: `${BASE_URL}/ar`, reuseExistingServer: true, timeout: 180_000 },
});
