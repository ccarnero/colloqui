import { describe, expect, it, mock } from "bun:test";

// `handle-invoke-requested-message.ts` imports `executeEndpointCallCore`
// from the real core lib (used only as the DEFAULT — every test below
// injects `executeCore` explicitly, so no Redis command ever actually
// runs), but that import still eagerly pulls in the breaker/adapter-client
// chain's module-level `new PinoLoggerService(...)` calls, so
// `@yoizen/observability` needs the fuller surface those modules import
// (mirrors `endpoint-call-core.spec.ts`). `createRedisClient()` itself is
// only called lazily inside getter functions (`getHttpBreaker()` /
// `getAdapterClient()`), never at module-eval time, so — unlike
// `endpoint-call-core.spec.ts`/`invocation-store.spec.ts`, which DO drive
// real Redis calls — this file deliberately does NOT mock `ioredis`.
mock.module("@yoizen/observability", () => ({
  logWithEnvelope: () => {},
  tracedFetch: mock(() => Promise.resolve(new Response("{}", { status: 200 }))),
  getMeter: () => ({
    createCounter: () => ({ add() {} }),
    createHistogram: () => ({ record() {} }),
  }),
  startNatsProducerSpan: () => ({ span: { end() {} } }),
  startNatsConsumerSpan: () => ({ span: { end() {} } }),
  injectTraceContext: () => {},
  activeOrRandomTraceId: () => "trace-1",
  createCircuitBreakerMetrics: () => ({
    recordDecision() {},
    recordTransition() {},
    recordL1Hit() {},
    recordRedisError() {},
    recordDecideDuration() {},
  }),
  PinoLoggerService: class FakeLogger {
    log() {}
    warn() {}
    error() {}
    debug() {}
  },
}));

const { handleInvokeRequestedMessage } = await import(
  "../../src/lib/invoke-consumer/handle-invoke-requested-message"
);
const { ok, err } = await import("../../src/lib/result");

import type { ParsedInvokeRequestedMessage } from "../../src/lib/invoke-consumer/parse-invoke-requested-envelope";

function baseParsed(): ParsedInvokeRequestedMessage {
  return {
    tenantId: "acme",
    invocationId: "inv-1",
    connectorId: "adp-1",
    endpointId: "ep-1",
    args: { method: "GET", url: "", adapterId: "adp-1", endpointId: "ep-1" },
    causal: { correlation_id: "corr-1", causation_id: "evt-1", depth: 0 },
  };
}

function fakeLogger() {
  return {
    log: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  };
}

function baseDeps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    parsed: baseParsed(),
    resultTtlSeconds: 900,
    executeCore: mock(async () =>
      ok({ status: 200, data: { ok: true }, headers: {}, cacheResult: "miss" })
    ),
    publish: mock(() => {}),
    parkInvocationResult: mock(async () => {}),
    publishInvokeCompleted: mock(async () => ok({ subject: "s" })),
    logger: fakeLogger(),
    logEnvelope: null,
    ...overrides,
  };
}

describe("handleInvokeRequestedMessage", () => {
  it("happy path: executes core, parks the result, publishes invoke_completed", async () => {
    const deps = baseDeps();
    await handleInvokeRequestedMessage(deps as never);
    expect(deps.executeCore).toHaveBeenCalledTimes(1);
    expect(deps.parkInvocationResult).toHaveBeenCalledTimes(1);
    const [record] = (deps.parkInvocationResult as ReturnType<typeof mock>).mock
      .calls[0]!;
    expect(record).toMatchObject({
      status: "completed",
      outcome: "ok",
      tenantId: "acme",
      invocationId: "inv-1",
    });
    expect(deps.publishInvokeCompleted).toHaveBeenCalledTimes(1);
  });

  it("parks BEFORE publishing invoke_completed (ack-after-park ordering)", async () => {
    const callOrder: string[] = [];
    const deps = baseDeps({
      parkInvocationResult: mock(async () => {
        callOrder.push("park");
      }),
      publishInvokeCompleted: mock(async () => {
        callOrder.push("publish");
        return ok({ subject: "s" });
      }),
    });
    await handleInvokeRequestedMessage(deps as never);
    expect(callOrder).toEqual(["park", "publish"]);
  });

  it("propagates a parking failure (caller naks -> redelivery, never swallowed)", async () => {
    const deps = baseDeps({
      parkInvocationResult: mock(async () => {
        throw new Error("redis down");
      }),
    });
    await expect(handleInvokeRequestedMessage(deps as never)).rejects.toThrow(
      /redis down/
    );
    // Never got to the best-effort publish step.
    expect(deps.publishInvokeCompleted).not.toHaveBeenCalled();
  });

  it("redelivery/crash-before-ack: parking the SAME invocationId twice is idempotent (same key, overwritten, no duplicate)", async () => {
    const parkInvocationResult = mock(async () => {});
    const deps = baseDeps({ parkInvocationResult });

    // Simulate redelivery: the same message handled twice.
    await handleInvokeRequestedMessage(deps as never);
    await handleInvokeRequestedMessage(deps as never);

    expect(parkInvocationResult).toHaveBeenCalledTimes(2);
    const [firstRecord] = parkInvocationResult.mock.calls[0]!;
    const [secondRecord] = parkInvocationResult.mock.calls[1]!;
    expect(firstRecord).toMatchObject({
      tenantId: "acme",
      invocationId: "inv-1",
      outcome: "ok",
    });
    expect(secondRecord).toMatchObject({
      tenantId: "acme",
      invocationId: "inv-1",
      outcome: "ok",
    });
  });

  it("never throws when publishInvokeCompleted rejects (best-effort, result already parked)", async () => {
    const deps = baseDeps({
      publishInvokeCompleted: mock(async () => err({ message: "broker down" })),
    });
    await expect(
      handleInvokeRequestedMessage(deps as never)
    ).resolves.toBeUndefined();
    expect(
      (deps.logger as ReturnType<typeof fakeLogger>).warn
    ).toHaveBeenCalled();
  });

  it("never throws when publishInvokeCompleted throws", async () => {
    const deps = baseDeps({
      publishInvokeCompleted: mock(async () => {
        throw new Error("network blip");
      }),
    });
    await expect(
      handleInvokeRequestedMessage(deps as never)
    ).resolves.toBeUndefined();
  });

  // --- webhook (T05) ---

  it("delivers the webhook when a target is present", async () => {
    const deliverWebhook = mock(async () => ok({ status: 200 }));
    const deps = baseDeps({
      parsed: {
        ...baseParsed(),
        webhook: { url: "https://caller.example/hook" },
      },
      deliverWebhook,
    });
    await handleInvokeRequestedMessage(deps as never);
    expect(deliverWebhook).toHaveBeenCalledTimes(1);
  });

  it("webhook-down: warns and still resolves (polling still works, result already parked)", async () => {
    const deliverWebhook = mock(async () =>
      err({ message: "connect ECONNREFUSED" })
    );
    const deps = baseDeps({
      parsed: {
        ...baseParsed(),
        webhook: { url: "https://caller.example/hook" },
      },
      deliverWebhook,
    });
    await expect(
      handleInvokeRequestedMessage(deps as never)
    ).resolves.toBeUndefined();
    expect(
      (deps.logger as ReturnType<typeof fakeLogger>).warn
    ).toHaveBeenCalled();
    // Parking already happened regardless of webhook outcome.
    expect(deps.parkInvocationResult).toHaveBeenCalledTimes(1);
  });

  it("webhook throwing never propagates", async () => {
    const deliverWebhook = mock(async () => {
      throw new Error("dns failure");
    });
    const deps = baseDeps({
      parsed: {
        ...baseParsed(),
        webhook: { url: "https://caller.example/hook" },
      },
      deliverWebhook,
    });
    await expect(
      handleInvokeRequestedMessage(deps as never)
    ).resolves.toBeUndefined();
  });

  it("skips webhook delivery (warns) when a target is present but no port is wired", async () => {
    const deps = baseDeps({
      parsed: {
        ...baseParsed(),
        webhook: { url: "https://caller.example/hook" },
      },
    });
    await handleInvokeRequestedMessage(deps as never);
    expect(
      (deps.logger as ReturnType<typeof fakeLogger>).warn
    ).toHaveBeenCalled();
  });

  it("never attempts webhook delivery when no target is present", async () => {
    const deliverWebhook = mock(async () => ok({ status: 200 }));
    const deps = baseDeps({ deliverWebhook });
    await handleInvokeRequestedMessage(deps as never);
    expect(deliverWebhook).not.toHaveBeenCalled();
  });

  // --- core failure still parks a result (error outcome) ---

  it("parks an error record when the core returns a failure Result (breaker open)", async () => {
    const parkInvocationResult = mock(async () => {});
    const deps = baseDeps({
      executeCore: mock(async () =>
        err({
          kind: "breaker_open",
          key: "k",
          status: "OPEN",
          reason: "too many failures",
          cooldownMs: 5000,
        })
      ),
      parkInvocationResult,
    });
    await handleInvokeRequestedMessage(deps as never);
    const [record] = parkInvocationResult.mock.calls[0]!;
    expect(record).toMatchObject({ status: "completed", outcome: "error" });
  });
});
