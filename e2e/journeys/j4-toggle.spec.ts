import { test, expect } from "@playwright/test";
import { api, login, workflowBody } from "./api";

// J4 — Toggle. A disabled workflow refuses a new execution; enabling it accepts execution again.
// Written by the manual loop (manual-loops/e2e-journeys.md, T04).
test.describe("J4 toggle", () => {
  let session: Awaited<ReturnType<typeof login>> | undefined;
  let workflowId: string | undefined;

  test.afterAll(async ({ request }) => {
    if (!session || !workflowId) return;
    const w = api(request, session);
    const deleted = await w.delete(`/workflows/${workflowId}`);
    expect(deleted.status(), await deleted.text()).toBe(204);
    expect((await w.get(`/workflows/${workflowId}`)).status()).toBe(404);
  });

  test("disabled refuses execute; enabled accepts it", async ({ request }) => {
    const s = await login(request);
    session = s;
    const w = api(request, s);

    const created = await w.post(
      "/workflows",
      workflowBody(`j4-toggle-${Date.now()}`),
    );
    const createdBody = (await created.json()) as Record<string, unknown>;
    if (typeof createdBody.id === "string") workflowId = createdBody.id;
    expect(created.status(), JSON.stringify(createdBody)).toBe(201);
    expect(workflowId).toBeTruthy();
    const id = workflowId as string;

    const disabled = await w.patch(`/workflows/${id}/status`, {
      status: "disabled",
    });
    const disabledBody = (await disabled.json()) as Record<string, unknown>;
    expect(disabled.status(), JSON.stringify(disabledBody)).toBe(200);
    expect(disabledBody.status).toBe("disabled");

    const refused = await w.post(`/workflows/${id}/execute`, {
      request: { nonce: `j4-off-${Date.now()}` },
    });
    const refusedBody = (await refused.json()) as Record<string, unknown>;
    expect(refused.status(), JSON.stringify(refusedBody)).toBe(409);
    expect(refusedBody.code).toBe("WORKFLOW_DISABLED");
    expect(refusedBody.workflowId).toBe(id);

    const enabled = await w.patch(`/workflows/${id}/status`, {
      status: "enabled",
    });
    const enabledBody = (await enabled.json()) as Record<string, unknown>;
    expect(enabled.status(), JSON.stringify(enabledBody)).toBe(200);
    expect(enabledBody.status).toBe("enabled");

    const run = await w.post(`/workflows/${id}/execute`, {
      request: { nonce: `j4-on-${Date.now()}` },
    });
    const runBody = (await run.json()) as Record<string, unknown>;
    expect(run.status(), JSON.stringify(runBody)).toBe(202);
    expect(typeof runBody.executionId).toBe("string");
  });
});
