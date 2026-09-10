import { test, expect } from "@playwright/test";
import { env } from "./env";
import { api, login } from "./api";
import { signIn } from "./console";

// J5 — Diagnose. The console's workflow and execution pages show the same ids the API returned; an unknown
// execution is 404 at the API and an error state in the console. Written by the manual loop
// (manual-loops/e2e-journeys.md, T05).
test.describe("J5 diagnose", () => {
  test.fixme("console shows the API's workflow and execution ids", async ({ page, request }) => {
    const s = await login(request);
    const w = api(request, s);
    const id = "<workflow created and executed in the test, as in J3>";
    const executionId = "<its execution id>";
    await signIn(page);
    await page.goto(`${env.consoleUrl}/workflows/${id}`);
    await expect(page.getByText(id)).toBeVisible();
    await expect(page.getByText(executionId)).toBeVisible();
    expect((await w.get(`/workflows/${id}/executions/00000000-0000-4000-8000-000000000000`)).status()).toBe(404);
  });
});
