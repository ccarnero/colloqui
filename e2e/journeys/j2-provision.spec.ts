import { test, expect } from "@playwright/test";
import { api, login } from "./api";

// J2 — Provision. A workflow created through the API gets a stable id, is listed for its tenant, is rejected
// when its schema is invalid, and can be deleted. Written by the manual loop (manual-loops/e2e-journeys.md, T02):
// the request bodies below must be filled from services/workflow-service/src/modules/workflows/dto.
test.describe("J2 provision", () => {
  let session: Awaited<ReturnType<typeof login>> | undefined;
  let workflowId: string | undefined;

  test.afterAll(async ({ request }) => {
    if (!session || !workflowId) return;
    const w = api(request, session);
    expect((await w.delete(`/workflows/${workflowId}`)).status()).toBeLessThan(
      300,
    );
    expect((await w.get(`/workflows/${workflowId}`)).status()).toBe(404);
  });

  test("create → get → list → delete keeps one stable id", async ({ request }) => {
    const s = await login(request);
    session = s;
    const w = api(request, s);
    const created = await w.post("/workflows", {
      name: `j2-provision-${Date.now()}`,
      application: "e2e-tests",
      actions: [
        {
          activity: "jsFunction",
          name: "return",
          args: { code: "return 1" },
        },
      ],
    });
    const createdBody = (await created.json()) as { id?: unknown };
    if (typeof createdBody.id === "string") workflowId = createdBody.id;
    expect(created.status()).toBe(201);
    expect(workflowId).toBeTruthy();
    const id = workflowId as string;
    expect((await w.get(`/workflows/${id}`)).status()).toBe(200);
    expect(JSON.stringify(await (await w.get("/workflows")).json())).toContain(id);
  });

  test("invalid schema → 400, nothing created", async ({ request }) => {
    const s = await login(request);
    const before = JSON.stringify(await (await api(request, s).get("/workflows")).json());
    expect((await api(request, s).post("/workflows", { name: 42 })).status()).toBe(400);
    expect(JSON.stringify(await (await api(request, s).get("/workflows")).json())).toBe(before);
  });
});
