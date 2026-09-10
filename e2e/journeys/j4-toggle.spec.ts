import { test, expect } from "@playwright/test";
import { api, login } from "./api";

// J4 — Toggle. PATCH /workflows/:id/status to disabled: execute is refused and no new execution appears;
// back to enabled: execute completes again. Written by the manual loop (manual-loops/e2e-journeys.md, T04).
test.describe("J4 toggle", () => {
  test.fixme("disabled refuses execute; enabled runs again", async ({ request }) => {
    const s = await login(request);
    const w = api(request, s);
    const id = "<workflow created in the test, as in J2>";
    expect((await w.patch(`/workflows/${id}/status`, { status: "disabled" })).status()).toBeLessThan(300);
    const refused = await w.post(`/workflows/${id}/execute`, { input: { nonce: `j4-off-${Date.now()}` } });
    expect([400, 409, 422]).toContain(refused.status());
    expect((await w.patch(`/workflows/${id}/status`, { status: "enabled" })).status()).toBeLessThan(300);
    const run = await w.post(`/workflows/${id}/execute`, { input: { nonce: `j4-on-${Date.now()}` } });
    expect(run.status()).toBeLessThan(300);
  });
});
