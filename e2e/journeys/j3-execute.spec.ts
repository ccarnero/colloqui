import { test, expect } from "@playwright/test";
import { api, login, workflowBody } from "./api";

// J3 — Execute. A workflow executed through the API produces one execution whose status settles and shows
// up under /workflows/:id/executions. Written by the manual loop (manual-loops/e2e-journeys.md, T03).
// Poll, never sleep: the execution id is the handle.
test.describe("J3 execute", () => {
  let session: Awaited<ReturnType<typeof login>> | undefined;
  let workflowId: string | undefined;

  test.afterAll(async ({ request }) => {
    if (!session || !workflowId) return;
    const w = api(request, session);
    const deleted = await w.delete(`/workflows/${workflowId}`);
    expect(deleted.status(), await deleted.text()).toBe(204);
    expect((await w.get(`/workflows/${workflowId}`)).status()).toBe(404);
  });

  test("POST /workflows/:id/execute settles and is listed", async ({ request }) => {
    test.setTimeout(180_000);
    const s = await login(request);
    session = s;
    const w = api(request, s);

    const created = await w.post(
      "/workflows",
      workflowBody(`j3-execute-${Date.now()}`),
    );
    const createdBody = (await created.json()) as Record<string, unknown>;
    if (typeof createdBody.id === "string") workflowId = createdBody.id;
    expect(created.status(), JSON.stringify(createdBody)).toBe(201);
    expect(workflowId).toBeTruthy();

    const id = workflowId as string;
    const nonce = `j3-${Date.now()}`;
    const run = await w.post(`/workflows/${id}/execute`, {
      request: { nonce },
    });
    const runBody = (await run.json()) as Record<string, unknown>;
    expect(run.status(), JSON.stringify(runBody)).toBe(202);
    expect(typeof runBody.executionId).toBe("string");
    const executionId = runBody.executionId as string;

    await expect
      .poll(
        async () => {
          const response = await w.get(
            `/workflows/${id}/executions/${executionId}`,
          );
          const body = (await response.json()) as Record<string, unknown>;
          expect(response.status(), JSON.stringify(body)).toBe(200);
          return body.status;
        },
        { timeout: 120_000 },
      )
      .toMatch(/completed|failed/i);

    const listed = await w.get(`/workflows/${id}/executions`);
    const listedBody = (await listed.json()) as Record<string, unknown>;
    expect(listed.status(), JSON.stringify(listedBody)).toBe(200);
    expect(JSON.stringify(listedBody)).toContain(executionId);
  });
});
