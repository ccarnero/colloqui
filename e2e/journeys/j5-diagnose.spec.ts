import { test, expect } from "@playwright/test";
import { api, login, workflowBody } from "./api";
import { expectWorkflowRunIds, signIn } from "./console";

// J5 — Diagnose. One API execution is identifiable by the same workflow and execution ids in the console;
// an unknown execution is 404 at the API. Written by the manual loop (manual-loops/e2e-journeys.md, T05).
test.describe("J5 diagnose", () => {
  let session: Awaited<ReturnType<typeof login>> | undefined;
  let workflowId: string | undefined;

  test.afterAll(async ({ request }) => {
    if (!session || !workflowId) return;
    const w = api(request, session);
    const deleted = await w.delete(`/workflows/${workflowId}`);
    expect(deleted.status(), await deleted.text()).toBe(204);
    expect((await w.get(`/workflows/${workflowId}`)).status()).toBe(404);
  });

  test("console shows the API's workflow and execution ids", async ({ page, request }) => {
    test.setTimeout(180_000);
    const s = await login(request);
    session = s;
    const w = api(request, s);

    const created = await w.post(
      "/workflows",
      workflowBody(`j5-diagnose-${Date.now()}`),
    );
    const createdBody = (await created.json()) as Record<string, unknown>;
    if (typeof createdBody.id === "string") workflowId = createdBody.id;
    expect(created.status(), JSON.stringify(createdBody)).toBe(201);
    expect(workflowId).toBeTruthy();
    const id = workflowId as string;

    const run = await w.post(`/workflows/${id}/execute`, {
      request: { nonce: `j5-${Date.now()}` },
    });
    const runBody = (await run.json()) as Record<string, unknown>;
    expect(run.status(), JSON.stringify(runBody)).toBe(202);
    expect(typeof runBody.executionId).toBe("string");
    const executionId = runBody.executionId as string;

    await expect
      .poll(
        async () => {
          const response = await w.get(`/workflows/${id}/executions/${executionId}`);
          const body = (await response.json()) as Record<string, unknown>;
          expect(response.status(), JSON.stringify(body)).toBe(200);
          return body.status;
        },
        { timeout: 120_000 },
      )
      .toMatch(/completed|failed/i);

    await signIn(page);
    await expectWorkflowRunIds(page, id, executionId);

    const unknown = await w.get(
      `/workflows/${id}/executions/00000000-0000-4000-8000-000000000000`,
    );
    expect(unknown.status(), await unknown.text()).toBe(404);
  });
});
