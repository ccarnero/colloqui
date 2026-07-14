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

  it("uses a client-supplied idempotencyKey as the invocationId even in mode: sync (pins parse-invoke-request-body.ts contract)", async () => {
    const executeCore = mock(async () =>
      ok({ status: 200, data: {}, headers: {}, cacheResult: "miss" })
    );
    const result = await handleInvokeRequest({
      ...baseDeps(),
      rawBody: {
        args: { method: "GET" },
        idempotencyKey: "client-sync-key",
      },
      executeCore,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ invocationId: "client-sync-key" });
    const call = executeCore.mock.calls[0]!;
    expect(call[5]).toBe("client-sync-key");
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

  // --- mode: "async" (T04) ---

  describe("mode: async", () => {
    const asyncDeps = () => ({
      ...baseDeps(),
      rawBody: { args: { method: "GET" }, mode: "async" },
    });

    it("returns 202 with invocationId and never calls executeCore", async () => {
      const executeCore = mock(async () =>
        ok({ status: 200, data: {}, headers: {} })
      );
      const publishInvokeRequest = mock(async () => ok({ subject: "s" }));
      const result = await handleInvokeRequest({
        ...asyncDeps(),
        executeCore,
        publishInvokeRequest,
      });
      expect(result.status).toBe(202);
      expect(result.body).toEqual({ invocationId: "inv-fixed-id" });
      expect(executeCore).not.toHaveBeenCalled();
      expect(publishInvokeRequest).toHaveBeenCalledTimes(1);
    });

    it("calls publishInvokeRequest with tenant/connector/endpoint/args/invocationId", async () => {
      const publishInvokeRequest = mock(async () => ok({ subject: "s" }));
      await handleInvokeRequest({
        ...asyncDeps(),
        publishInvokeRequest,
      });
      expect(publishInvokeRequest).toHaveBeenCalledTimes(1);
      const call = publishInvokeRequest.mock.calls[0]![0];
      expect(call).toMatchObject({
        tenantId: "tenant-abc",
        connectorId: "adp-1",
        endpointId: "ep-1",
        invocationId: "inv-fixed-id",
      });
    });

    it("dedup contract: same idempotencyKey across two requests -> same invocationId (same Nats-Msg-Id)", async () => {
      const publishInvokeRequest = mock(async () => ok({ subject: "s" }));
      const deps = {
        ...asyncDeps(),
        rawBody: {
          args: { method: "GET" },
          mode: "async",
          idempotencyKey: "client-retry-key",
        },
        publishInvokeRequest,
      };

      const first = await handleInvokeRequest(deps);
      const second = await handleInvokeRequest(deps);

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(first.body).toEqual({ invocationId: "client-retry-key" });
      expect(second.body).toEqual({ invocationId: "client-retry-key" });
      expect(publishInvokeRequest).toHaveBeenCalledTimes(2);
      const firstCallArgs = publishInvokeRequest.mock.calls[0]![0];
      const secondCallArgs = publishInvokeRequest.mock.calls[1]![0];
      expect(firstCallArgs.invocationId).toBe(secondCallArgs.invocationId);
    });

    it("without idempotencyKey, each request gets a fresh (generated) invocationId", async () => {
      let counter = 0;
      const publishInvokeRequest = mock(async () => ok({ subject: "s" }));
      const deps = {
        ...asyncDeps(),
        generateInvocationId: () => `gen-${++counter}`,
        publishInvokeRequest,
      };

      const first = await handleInvokeRequest(deps);
      const second = await handleInvokeRequest(deps);

      expect(first.body).toEqual({ invocationId: "gen-1" });
      expect(second.body).toEqual({ invocationId: "gen-2" });
    });

    it("returns 503 when publishInvokeRequest fails (never silently accepted)", async () => {
      const publishInvokeRequest = mock(async () =>
        err({ message: "invoke subject not stream-bound" })
      );
      const result = await handleInvokeRequest({
        ...asyncDeps(),
        publishInvokeRequest,
      });
      expect(result.status).toBe(503);
      expect(result.body).toMatchObject({
        invocationId: "inv-fixed-id",
        error: "invoke subject not stream-bound",
      });
    });

    it("still enforces tenant guard and rate limit before publishing", async () => {
      const publishInvokeRequest = mock(async () => ok({ subject: "s" }));
      const missingTenant = await handleInvokeRequest({
        ...asyncDeps(),
        tenantHeader: null,
        publishInvokeRequest,
      });
      expect(missingTenant.status).toBe(400);
      expect(publishInvokeRequest).not.toHaveBeenCalled();
    });

    it("throws when mode=async but publishInvokeRequest was not wired (entrypoint misconfiguration)", async () => {
      await expect(handleInvokeRequest(asyncDeps())).rejects.toThrow(
        /publishInvokeRequest/
      );
    });

    // --- result parking (T05) ---

    it("parks a pending record after a successful async publish", async () => {
      const publishInvokeRequest = mock(async () => ok({ subject: "s" }));
      const parkPendingInvocation = mock(async () => {});
      const result = await handleInvokeRequest({
        ...asyncDeps(),
        publishInvokeRequest,
        parkPendingInvocation,
      });
      expect(result.status).toBe(202);
      expect(parkPendingInvocation).toHaveBeenCalledTimes(1);
      const [record, ttl] = parkPendingInvocation.mock.calls[0]!;
      expect(record).toMatchObject({
        status: "pending",
        tenantId: "tenant-abc",
        invocationId: "inv-fixed-id",
      });
      expect(typeof ttl).toBe("number");
    });

    it("still returns 202 when parkPendingInvocation rejects (best-effort, never blocks accept)", async () => {
      const publishInvokeRequest = mock(async () => ok({ subject: "s" }));
      const parkPendingInvocation = mock(async () => {
        throw new Error("redis down");
      });
      const result = await handleInvokeRequest({
        ...asyncDeps(),
        publishInvokeRequest,
        parkPendingInvocation,
      });
      expect(result.status).toBe(202);
    });

    it("never calls parkPendingInvocation when the publish itself fails", async () => {
      const publishInvokeRequest = mock(async () =>
        err({ message: "not stream-bound" })
      );
      const parkPendingInvocation = mock(async () => {});
      await handleInvokeRequest({
        ...asyncDeps(),
        publishInvokeRequest,
        parkPendingInvocation,
      });
      expect(parkPendingInvocation).not.toHaveBeenCalled();
    });

    it("threads webhook into publishInvokeRequest when provided", async () => {
      const publishInvokeRequest = mock(async () => ok({ subject: "s" }));
      await handleInvokeRequest({
        ...asyncDeps(),
        rawBody: {
          args: { method: "GET" },
          mode: "async",
          webhook: { url: "https://caller.example/hook" },
        },
        publishInvokeRequest,
      });
      const call = publishInvokeRequest.mock.calls[0]![0];
      expect(call.webhook).toEqual({ url: "https://caller.example/hook" });
    });
  });
});
