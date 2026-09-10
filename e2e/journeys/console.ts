import { expect, type Page } from "@playwright/test";
import { env } from "./env";

// The console side: sign in through the real login form (Angular Material, same selectors as
// e2e/sales-agent-setup.spec.ts) and land on the dashboard.
const fill = async (page: Page, label: string, value: string) => {
  const field = page.locator("mat-form-field").filter({ hasText: label }).first();
  await field.click();
  await field.locator("input, textarea").first().fill(value);
};

export const signIn = async (page: Page): Promise<void> => {
  await page.goto(`${env.consoleUrl}/login`);
  await fill(page, "Email", env.email);
  await fill(page, "Password", env.password);
  const tenantField = page.locator("mat-form-field").filter({ hasText: "Tenant ID" });
  if (await tenantField.isVisible().catch(() => false)) await fill(page, "Tenant ID", env.tenant);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
  await expect(page.locator("app-shell, [class*=\"sidebar\"]").first()).toBeVisible();
};
