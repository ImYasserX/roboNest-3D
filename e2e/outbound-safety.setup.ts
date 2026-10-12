import { expect, test } from "@playwright/test";

// Runs before every other E2E test (playwright.config.ts → dependencies).
// If the server under test could send real emails, Telegram alerts, SMS or
// payment requests, stop the whole suite before any order is created.
test("outbound integrations are disabled on the server under test", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.outbound, "Start the E2E server with --var OUTBOUND_INTEGRATIONS:disabled (or set it on staging)").toBe("disabled");
});
