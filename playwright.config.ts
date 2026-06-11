import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for admin-console E2E tests.
 *
 * Usage:
 *   npx playwright test                         — run all specs
 *   npx playwright test e2e/sales-agent-setup   — run the sales-agent suite
 *   npx playwright test --headed                — see the browser
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Sales flow is sequential — must run in order
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // One worker — tests share state (login, entities)
  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4200",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
