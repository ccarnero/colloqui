import { describe, it, expect, afterAll } from "bun:test";
import { getBaseUrl, httpPost, httpGet, httpDelete } from "./helpers";
import { authHeaders } from "./auth.setup";

const GW = getBaseUrl("api-gateway");

const TENANT_NAME = `e2e-err-${Date.now().toString(36)}`;
const createdTenants: string[] = [];

afterAll(async () => {
  const h = await authHeaders();
  await Promise.all(
    createdTenants.map((name) =>
      httpDelete(`${GW}/tenants/${name}`, { headers: h }),
    ),
  );
});

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

describe("E2E: error propagation", () => {
  it("should propagate 409 Conflict from tenant-service", async () => {
    const h = await authHeaders();

    const first = await httpPost<{ name: string }>(
      `${GW}/tenants`,
      { name: TENANT_NAME },
      { headers: h },
    );
    expect(first.status).toBe(201);
    createdTenants.push(TENANT_NAME);

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
});
