import { describe, it, expect, afterAll, beforeAll } from "bun:test";
import { getBaseUrl, httpPost, httpGet, httpDelete, poll } from "./helpers";
import { authHeaders } from "./auth.setup";

const GW = getBaseUrl("api-gateway");

const TENANT_NAME = `e2e-t-${Date.now().toString(36)}`;
const createdTenants: string[] = [];

const PROVISION_POLL_TIMEOUT_MS = Number.parseInt(
  process.env.TENANT_E2E_PROVISION_TIMEOUT_MS ?? "300000",
  10,
);

let createdTenantId: string | null = null;

afterAll(async () => {
  const h = await authHeaders();
  await Promise.all(
    createdTenants.map((name) =>
      httpDelete(`${GW}/tenants/${name}`, { headers: h }),
    ),
  );
});

describe("E2E: tenant-service", () => {
  beforeAll(async () => {
    const h = await authHeaders();
    const { status, body } = await httpPost<{
      name: string;
      id: string;
      provisioningStatus: string;
    }>(`${GW}/tenants`, { name: TENANT_NAME }, { headers: h });

    expect(status).toBe(202);
    expect(body.name).toBe(TENANT_NAME);
    expect(body.provisioningStatus).toBe("pending");
    createdTenantId = body.id;
    createdTenants.push(TENANT_NAME);

    await poll(
      async () => {
        const r = await httpGet<{ provisioningStatus: string }>(
          `${GW}/tenants/${body.id}`,
          { headers: h },
        );
        if (r.status !== 200) return null;
        if (r.body.provisioningStatus === "ready") return r.body;
        if (r.body.provisioningStatus === "failed") {
          throw new Error("Tenant provisioning failed in E2E");
        }
        return null;
      },
      { timeoutMs: PROVISION_POLL_TIMEOUT_MS, initialDelayMs: 2_000, maxDelayMs: 8_000 },
    );
  }, PROVISION_POLL_TIMEOUT_MS + 30_000);

  it("should list tenants including the created one", async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<
      Array<{ name: string; id?: string }>
    >(`${GW}/tenants`, {
      headers: h,
    });

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const names = body.map((t) => t.name);
    expect(names).toContain(TENANT_NAME);
    const withId = body.find((t) => t.name === TENANT_NAME);
    if (createdTenantId) {
      expect(withId?.id).toBe(createdTenantId);
    }
  });

  it("should get a specific tenant by name", async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<{
      name: string;
      provisioningStatus: string;
    }>(`${GW}/tenants/${TENANT_NAME}`, { headers: h });

    expect(status).toBe(200);
    expect(body.name).toBe(TENANT_NAME);
    expect(body.provisioningStatus).toBe("ready");
  });

  it("should get the same tenant by platform id", async () => {
    if (!createdTenantId) {
      expect(createdTenantId).toBeDefined();
      return;
    }
    const h = await authHeaders();
    const { status, body } = await httpGet<{
      name: string;
      id: string;
    }>(`${GW}/tenants/${createdTenantId}`, { headers: h });
    expect(status).toBe(200);
    expect(body.id).toBe(createdTenantId);
    expect(body.name).toBe(TENANT_NAME);
  });

  it("should delete the tenant", async () => {
    const h = await authHeaders();
    const { status } = await httpDelete(`${GW}/tenants/${TENANT_NAME}`, {
      headers: h,
    });

    expect(status).toBe(204);
    createdTenants.splice(createdTenants.indexOf(TENANT_NAME), 1);
  }, 30_000);

  it("should show tenant as terminating after delete or 404", async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<{
      name: string;
      namespaces?: Array<{ phase: string }>;
    }>(`${GW}/tenants/${TENANT_NAME}`, { headers: h });

    if (status === 404) return;

    expect(status).toBe(200);
    expect(body.namespaces?.[0]?.phase).toBe("Terminating");
  });
});
