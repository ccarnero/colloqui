import { test, expect } from "@playwright/test";
import { env } from "./env";
import { api, login } from "./api";
import { signIn } from "./console";

// J1 — Access. Anonymous console navigation ends at login; a real login lands on the dashboard;
// the API refuses a missing token with 401 and a foreign tenant with 401/403, never with records.
test.describe("J1 access", () => {
  test("anonymous /workflows redirects to login", async ({ page }) => {
    await page.goto(`${env.consoleUrl}/workflows`);
    await page.waitForURL("**/login**", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("login reaches the dashboard and the workflows list", async ({ page }) => {
    await signIn(page);
    await page.goto(`${env.consoleUrl}/workflows`);
    await expect(page).toHaveURL(/\/workflows/);
  });

  test("API without token → 401", async ({ request }) => {
    const res = await api(request, null).get("/workflows");
    expect(res.status()).toBe(401);
  });

  test("API with a token of another tenant → 401 or 403, no records", async ({ request }) => {
    const s = await login(request);
    const res = await api(request, s).get("/workflows", env.foreignTenant);
    expect([401, 403]).toContain(res.status());
    const text = await res.text();
    expect(text).not.toMatch(/"items"\s*:\s*\[\s*\{/);
  });
});
