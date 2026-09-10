import { test, expect } from "@playwright/test";
import { api, login } from "./api";

// J3 — Execute. A workflow executed through the API produces one execution whose status settles, with the
// input echoed in the result, and shows up under /workflows/:id/executions. Written by the manual loop
// (manual-loops/e2e-journeys.md, T03). Poll, never sleep: the execution id is the handle.
test.describe("J3 execute", () => {
  test.fixme("POST /workflows/:id/execute settles and is listed", async ({ request }) => {
    const s = await login(request);
    const w = api(request, s);
    const id = "<workflow created in the test, as in J2>";
    const nonce = `j3-${Date.now()}`;
    const run = await w.post(`/workflows/${id}/execute`, { input: { nonce } });
    expect(run.status()).toBeLessThan(300);
    const executionId = ((await run.json()) as { executionId?: string; id?: string }).executionId;
    await expect.poll(async () => ((await (await w.get(`/workflows/${id}/executions/${executionId}`)).json()) as { status: string }).status, { timeout: 120_000 })
      .toMatch(/completed|failed/i);
    expect(JSON.stringify(await (await w.get(`/workflows/${id}/executions`)).json())).toContain(String(executionId));
  });
});
