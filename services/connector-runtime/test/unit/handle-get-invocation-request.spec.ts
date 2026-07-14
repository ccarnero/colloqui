import { describe, expect, it, mock } from "bun:test";
import { handleGetInvocationRequest } from "../../src/lib/http-facade/handle-get-invocation-request";

describe("handleGetInvocationRequest", () => {
  it("returns 400 when the tenant header is missing", async () => {
    const getInvocationRecord = mock(async () => null);
    const result = await handleGetInvocationRequest({
      tenantHeader: null,
      invocationId: "inv-1",
      getInvocationRecord,
    });
    expect(result.status).toBe(400);
    expect(getInvocationRecord).not.toHaveBeenCalled();
  });

  it("returns 404 status:expired when the record is missing (never existed OR expired)", async () => {
    const getInvocationRecord = mock(async () => null);
    const result = await handleGetInvocationRequest({
      tenantHeader: "acme",
      invocationId: "inv-1",
      getInvocationRecord,
    });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ invocationId: "inv-1", status: "expired" });
  });

  it("returns 200 status:pending when the record is pending", async () => {
    const getInvocationRecord = mock(async () => ({
      status: "pending" as const,
      tenantId: "acme",
      invocationId: "inv-1",
      acceptedAt: "2026-07-14T00:00:00.000Z",
    }));
    const result = await handleGetInvocationRequest({
      tenantHeader: "acme",
      invocationId: "inv-1",
      getInvocationRecord,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ invocationId: "inv-1", status: "pending" });
  });

  it("returns 200 status:completed with the result on success", async () => {
    const getInvocationRecord = mock(async () => ({
      status: "completed" as const,
      tenantId: "acme",
      invocationId: "inv-1",
      completedAt: "2026-07-14T00:00:00.000Z",
      outcome: "ok" as const,
      result: { status: 200, data: { hello: "world" }, headers: {} },
    }));
    const result = await handleGetInvocationRequest({
      tenantHeader: "acme",
      invocationId: "inv-1",
      getInvocationRecord,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      invocationId: "inv-1",
      status: "completed",
      outcome: "ok",
      result: { status: 200, data: { hello: "world" }, headers: {} },
    });
  });

  it("returns 200 status:completed with the error on failure outcome", async () => {
    const getInvocationRecord = mock(async () => ({
      status: "completed" as const,
      tenantId: "acme",
      invocationId: "inv-1",
      completedAt: "2026-07-14T00:00:00.000Z",
      outcome: "error" as const,
      error: { kind: "http_error", message: "boom" },
    }));
    const result = await handleGetInvocationRequest({
      tenantHeader: "acme",
      invocationId: "inv-1",
      getInvocationRecord,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: "completed",
      outcome: "error",
      error: { kind: "http_error", message: "boom" },
    });
  });

  it("scopes the lookup by the caller's tenant (cross-tenant isolation)", async () => {
    const getInvocationRecord = mock(async () => null);
    await handleGetInvocationRequest({
      tenantHeader: "attacker-tenant",
      invocationId: "victim-inv-1",
      getInvocationRecord,
    });
    expect(getInvocationRecord).toHaveBeenCalledWith(
      "attacker-tenant",
      "victim-inv-1"
    );
  });
});
