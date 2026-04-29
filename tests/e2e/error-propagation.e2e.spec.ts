import { describe, it, expect, afterAll } from "bun:test";
import { getBaseUrl, httpPost, httpGet, httpDelete, poll } from "./helpers";
import { authHeaders } from "./auth.setup";

const GW = getBaseUrl("api-gateway");

const TENANT_NAME = `e2e-err-${Date.now().toString(36)}`;
// O(1) membership / removal via Set instead of Array.filter scans.
const createdTenants = new Set<string>();

// `expect([...]).toContain(status)` over `Set.has(...).toBe(true)`:
// same O(1) hashed lookup, but bun:test prints the actual status when the
// assertion fails (otherwise we just see `Expected: true / Received: false`).
const SUCCESSFUL_DELETE_STATUSES = [200, 202, 204] as const;

afterAll(async () => {
  if (createdTenants.size === 0) return;
  const h = await authHeaders();
  await Promise.all(
    Array.from(createdTenants, (name) =>
      httpDelete(`${GW}/tenants/${encodeURIComponent(name)}`, { headers: h }),
    ),
  );
});

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

interface TenantDetail {
  name: string;
  provisioningStatus: "pending" | "provisioning" | "ready" | "failed";
  provisioningError?: string | null;
}

// Terminal provisioning states. Tenant-service only accepts a DELETE once
// the tenant is no longer in `pending`/`provisioning`, so the 409 test
// races provisioning if it runs DELETE too eagerly. Mirrors the gate used
// by `tenant.e2e.spec.ts > beforeAll` and `auth.setup.ts:ensureTenantProvisioned`.
const TERMINAL_PROVISIONING_STATES = new Set<TenantDetail["provisioningStatus"]>([
  "ready",
  "failed",
]);

describe("E2E: error propagation", () => {
  it("should propagate 409 Conflict from tenant-service", async () => {
    const h = await authHeaders();

    const first = await httpPost<{ name: string }>(
      `${GW}/tenants`,
      { name: TENANT_NAME },
      { headers: h },
    );
    expect(first.status).toBe(202);
    createdTenants.add(TENANT_NAME);

    const duplicate = await httpPost<ErrorBody>(
      `${GW}/tenants`,
      { name: TENANT_NAME },
      { headers: h },
    );

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.statusCode).toBe(409);
    expect(duplicate.body.message).toContain(TENANT_NAME);
    expect(duplicate.body.error).toBe("Conflict");
  }, 30_000);

  it("should propagate 400 Bad Request for invalid workflow body", async () => {
    const h = await authHeaders();

    const { status, body } = await httpPost<ErrorBody>(
      `${GW}/workflows`,
      {},
      { headers: h },
    );

    expect(status).toBe(400);
    expect(body.statusCode).toBe(400);
    expect(body.message).toBeDefined();
  });

  it("should propagate 404 from downstream services", async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<ErrorBody>(
      `${GW}/audit/events/nonexistent-err-prop-id`,
      { headers: h },
    );

    expect(status).toBe(404);
  });

  it("should return structured JSON for all error responses", async () => {
    const h = await authHeaders();

    const { status, body } = await httpPost<ErrorBody>(
      `${GW}/tenants`,
      { name: TENANT_NAME },
      { headers: h },
    );

    expect(status).toBe(409);
    expect(typeof body).toBe("object");
    expect(typeof body.statusCode).toBe("number");
    expect(body.message).toBeDefined();
  }, 30_000);

  // Asserts the *happy path* of tenant deletion plus 404 propagation
  // afterwards. Runs last so the preceding 409 / structured-JSON cases
  // still observe the tenant.
  //
  // Tenant-service is async: POST /tenants returns 202 and provisioning
  // continues in the background. DELETE during `pending`/`provisioning`
  // races the provisioner and is rejected with a non-2xx, so we first
  // poll until provisioning reaches a terminal state, mirroring the
  // gate used by `tenant.e2e.spec.ts > beforeAll`.
  //
  // On success the tenant is dropped from `createdTenants`, so the
  // `afterAll` net becomes a no-op (still tolerates failure modes
  // where this test bails out before reaching that point).
  it("should delete the tenant and propagate 404 once it's gone", async () => {
    const h = await authHeaders();
    const url = `${GW}/tenants/${encodeURIComponent(TENANT_NAME)}`;

    const ready = await poll(
      async () => {
        const r = await httpGet<TenantDetail>(url, { headers: h });
        if (r.status !== 200) return null;
        if (r.body.provisioningStatus === "failed") {
          throw new Error(
            `Tenant '${TENANT_NAME}' provisioning failed: ${r.body.provisioningError ?? "unknown"}`,
          );
        }
        return TERMINAL_PROVISIONING_STATES.has(r.body.provisioningStatus)
          ? r.body
          : null;
      },
      { timeoutMs: 60_000, initialDelayMs: 500, maxDelayMs: 2_000 },
    );
    expect(ready.provisioningStatus).toBe("ready");

    const del = await httpDelete<ErrorBody>(url, { headers: h });
    expect(SUCCESSFUL_DELETE_STATUSES).toContain(del.status);

    await poll(
      async () => {
        const res = await httpGet<ErrorBody>(url, { headers: h });
        return res.status === 404 ? true : null;
      },
      { timeoutMs: 60_000, initialDelayMs: 500, maxDelayMs: 2_000 },
    );

    const followUp = await httpGet<ErrorBody>(url, { headers: h });
    expect(followUp.status).toBe(404);
    expect(followUp.body.statusCode).toBe(404);

    createdTenants.delete(TENANT_NAME);
  }, 150_000);
});
