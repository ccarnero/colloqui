import { test, expect } from "@playwright/test";
import { api, login } from "./api";

// J2 — Provision. A workflow created through the API gets a stable id, is listed for its tenant, is rejected
// when its schema is invalid, and can be deleted. Written by the manual loop (manual-loops/e2e-journeys.md, T02):
// the request bodies below must be filled from services/workflow-service/src/modules/workflows/dto.
test.describe("J2 provision", () => {
  test.fixme("create → get → list → delete keeps one stable id", async ({ request }) => {
    const s = await login(request);
    const w = api(request, s);
    const created = await w.post("/workflows", { /* minimal valid CreateWorkflowDto */ });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    expect((await w.get(`/workflows/${id}`)).status()).toBe(200);
    expect(JSON.stringify(await (await w.get("/workflows")).json())).toContain(id);
    expect((await w.delete(`/workflows/${id}`)).status()).toBeLessThan(300);
    expect((await w.get(`/workflows/${id}`)).status()).toBe(404);
  });

  test.fixme("invalid schema → 400, nothing created", async ({ request }) => {
    const s = await login(request);
    const before = JSON.stringify(await (await api(request, s).get("/workflows")).json());
    expect((await api(request, s).post("/workflows", { name: 42 })).status()).toBe(400);
    expect(JSON.stringify(await (await api(request, s).get("/workflows")).json())).toBe(before);
  });
});
