import { describe, expect, it, mock } from "bun:test";
import type { EndpointCallError } from "../../src/lib/endpoint-call-core";
import { createRateLimitState } from "../../src/lib/http-facade/check-rate-limit";
import { handleInvokeRequest } from "../../src/lib/http-facade/handle-invoke-request";
import { err, ok } from "../../src/lib/result";

const baseDeps = () => ({
  tenantHeader: "tenant-abc",
  connectorId: "adp-1",
  endpointId: "ep-1",
  rawBody: { args: { method: "GET" } },
  rateLimitState: createRateLimitState(),
  rateLimitConfig: { limit: 100, windowMs: 60_000 },
  generateInvocationId: () => "inv-fixed-id",
  publish: mock(() => {}),
});

describe("handleInvokeRequest", () => {
  it("returns 400 when the tenant header is missing", async () => {
    const executeCore = mock(async () =>
      ok({ status: 200, data: {}, headers: {} })
    );
    const result = await handleInvokeRequest({
      ...baseDeps(),
      tenantHeader: null,
      executeCore,
    });
    expect(result.status).toBe(400);
    expect(executeCore).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    const rateLimitState = createRateLimitState();
    const rateLimitConfig = { limit: 1, windowMs: 60_000 };
    const executeCore = mock(async () =>
      ok({ status: 200, data: {}, headers: {} })
    );

    // First request consumes the single allowed slot.
    await handleInvokeRequest({
      ...baseDeps(),
      rateLimitState,
      rateLimitConfig,
      executeCore,
    });
    executeCore.mockClear();

    const result = await handleInvokeRequest({
      ...baseDeps(),
      rateLimitState,
      rateLimitConfig,
      executeCore,
    });
    expect(result.status).toBe(429);
    expect(executeCore).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid request body", async () => {
    const executeCore = mock(async () =>
      ok({ status: 200, data: {}, headers: {} })
    );
    const result = await handleInvokeRequest({
      ...baseDeps(),
      rawBody: {},
      executeCore,
    });
    expect(result.status).toBe(400);
    expect(executeCore).not.toHaveBeenCalled();
  });

  it("returns 200 with invocationId + core result on success", async () => {
    const executeCore = mock(async () =>
      ok({
        status: 200,
        data: { hello: "world" },
        headers: {},
        cacheResult: "miss",
      })
    );
    const result = await handleInvokeRequest({
      ...baseDeps(),
      executeCore,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      invocationId: "inv-fixed-id",
      status: 200,
      data: { hello: "world" },
      headers: {},
      cacheResult: "miss",
    });
    expect(executeCore).toHaveBeenCalledTimes(1);
    // args, tenantId, causal, publish, httpResponseCache, invocationId
    const call = executeCore.mock.calls[0]!;
    expect(call[1]).toBe("tenant-abc");
    expect(call[2]).toBeUndefined();
    expect(call[5]).toBe("inv-fixed-id");
  });

  it("maps breaker_open to 503", async () => {
    const error: EndpointCallError = {
      kind: "breaker_open",
      key: "k",
      status: "OPEN",
      reason: "too many failures",
      cooldownMs: 5000,
    };
    const executeCore = mock(async () => err(error));
    const result = await handleInvokeRequest({ ...baseDeps(), executeCore });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      invocationId: "inv-fixed-id",
      error: "circuit_open",
      retryAfterMs: 5000,
    });
  });

  it("maps invalid_args to 400", async () => {
    const error: EndpointCallError = {
      kind: "invalid_args",
      code: "INVALID_ENDPOINT_CALL_ARGS",
      message: "bad",
    };
    const executeCore = mock(async () => err(error));
    const result = await handleInvokeRequest({ ...baseDeps(), executeCore });
    expect(result.status).toBe(400);
  });

  it("maps http_error to 502 and timeout to 504", async () => {
    const httpErr: EndpointCallError = {
      kind: "http_error",
      message: "boom",
      cause: new Error("boom"),
    };
    const executeCoreHttp = mock(async () => err(httpErr));
    const httpResult = await handleInvokeRequest({
      ...baseDeps(),
      executeCore: executeCoreHttp,
    });
    expect(httpResult.status).toBe(502);

    const timeoutErr: EndpointCallError = {
      kind: "timeout",
      message: "slow",
      cause: new Error("slow"),
    };
    const executeCoreTimeout = mock(async () => err(timeoutErr));
    const timeoutResult = await handleInvokeRequest({
      ...baseDeps(),
      executeCore: executeCoreTimeout,
    });
    expect(timeoutResult.status).toBe(504);
  });
});
