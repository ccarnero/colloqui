import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ---- mock @yoizen/observability before any module import ----
//
// WIDE, side-effect-free stub (mirrors `endpoint-call-core.spec.ts`'s
// surface) rather than importing the real module: `mock.module` overrides
// are process-global and persist for the rest of the `bun test` process, so
// a NARROW stub here previously broke other spec files that (transitively,
// via the real `executeEndpointCallCore` import chain) need `tracedFetch` /
// `startNatsProducerSpan` / etc. Importing the REAL module instead was tried
// and made things WORSE — the real `@yoizen/observability` package has its
// own side effects (OTel SDK setup) that raced with other tests' teardown.
// A comprehensive fake surface avoids both hazards.
mock.module("@yoizen/observability", () => ({
  getMeter: () => ({
    createCounter: () => ({ add() {} }),
    createHistogram: () => ({ record() {} }),
  }),
  tracedFetch: () => Promise.resolve(new Response("{}", { status: 200 })),
  startNatsProducerSpan: () => ({ span: { end() {} } }),
  startNatsConsumerSpan: () => ({ span: { end() {} } }),
  activeOrRandomTraceId: () => "trace-1",
  logWithEnvelope: () => {},
  injectTraceContext: () => {},
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
  },
}));

// ---- mock @yoizen/shared with real-ish implementations ----
//
// Same wide-stub rationale as above: `createAdapterClientWithRedisAndFetch`
// is added as a no-op stub purely so OTHER spec files that transitively
// import the real `adapter-client.provider.ts` (which imports it at
// module-eval time) don't crash if this file's mock happens to still be
// registered when they run — this file itself never calls it.
mock.module("@yoizen/shared", () => ({
  platformServiceUrl: (name: string) => `http://${name}.svc`,
  RATE_LIMIT_DEFAULT_LIMIT: 100,
  RATE_LIMIT_DEFAULT_WINDOW_MS: 60_000,
  computeBreakerKey: (params: Record<string, unknown>) =>
    JSON.stringify(params),
  createAdapterClientWithRedisAndFetch: () => ({
    resolveRequest: () =>
      Promise.reject(new Error("not implemented in test stub")),
  }),
  buildSubject: ({
    tenant,
    producer,
    domain,
    channel,
    provider,
    kind,
    version,
  }: Record<string, string>) =>
    `evt.${tenant}.${producer}.${domain}.${channel}.${provider}.${kind}.${version}`,
  parseSubject: (subject: string) => {
    const parts = subject.split(".");
    if (parts.length !== 8 || parts[0] !== "evt") {
      return null;
    }
    return {
      tenant: parts[1],
      producer: parts[2],
      domain: parts[3],
      channel: parts[4],
      provider: parts[5],
      kind: parts[6],
      version: parts[7],
    };
  },
  buildEventEnvelope: (params: Record<string, unknown>) => ({
    id: "generated-event-id",
    type: params["type"],
    source: params["source"],
    resource: params["resource"],
    data: { payload: params["payload"] },
    tenant: params["tenant"],
    correlation_id: params["correlationId"] ?? "generated-correlation-id",
    causation_id: params["causationId"] ?? null,
    transport: { depth: (params["depth"] as number | undefined) ?? 0 },
  }),
  TENANT_HEADER: "x-yoizen-tenant",
}));

// ---- fake JetStream publish spy + JetStreamManager.streams.list spy ----
let publishSpy: ReturnType<typeof mock>;
let listSpy: ReturnType<typeof mock>;
let corePublishSpy: ReturnType<typeof mock>;
let fakeHeaders: Map<string, string>;
let fakeStreamNames: string[];

mock.module("nats", () => {
  publishSpy = mock(async () => ({ seq: 1 }));
  fakeStreamNames = ["INGRESS-acme"];
  listSpy = mock(function list() {
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const name of fakeStreamNames) {
          yield { config: { name } };
        }
      },
    };
  });
  corePublishSpy = mock(() => {});
  fakeHeaders = new Map<string, string>();
  const hdrs = {
    set: (k: string, v: string) => fakeHeaders.set(k, v),
    get: (k: string) => fakeHeaders.get(k),
  };
  return {
    connect: mock(async () => ({
      isClosed: () => false,
      jetstream: () => ({ publish: publishSpy }),
      jetstreamManager: async () => ({ streams: { list: listSpy } }),
      publish: corePublishSpy,
      flush: async () => {},
    })),
    headers: () => hdrs,
  };
});

// Import AFTER all mocks are in place
const {
  publishInvokeRequestEvent,
  publishInvokeCompletedEvent,
  assertInvokeSubjectStreamBound,
  buildInvokeRequestedSubject,
} = await import("../../src/activities/_shared/invoke-request-publisher");

describe("publishInvokeRequestEvent", () => {
  beforeEach(() => {
    publishSpy.mockClear();
    corePublishSpy.mockClear();
    fakeHeaders.clear();
  });

  afterEach(() => {
    publishSpy.mockClear();
    corePublishSpy.mockClear();
    fakeHeaders.clear();
  });

  const baseArgs = {
    tenantId: "tenant-abc",
    invocationId: "inv-1",
    connectorId: "adp-1",
    endpointId: "ep-1",
    args: { method: "GET", url: "", adapterId: "adp-1", endpointId: "ep-1" },
  };

  it("publishes to the invoke_requested subject", async () => {
    const result = await publishInvokeRequestEvent(baseArgs);
    expect(result.ok).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const subject = publishSpy.mock.calls[0]![0] as string;
    expect(subject).toBe(
      "evt.tenant-abc.connector-runtime.platform.endpoint.system.invoke_requested.v1"
    );
  });

  it("sets Nats-Msg-Id and msgID option to the invocationId (dedup contract)", async () => {
    await publishInvokeRequestEvent(baseArgs);
    expect(fakeHeaders.get("Nats-Msg-Id")).toBe("inv-1");
    const opts = publishSpy.mock.calls[0]![2] as { msgID: string };
    expect(opts.msgID).toBe("inv-1");
  });

  it("dedup contract: two publishes with the same invocationId use the same Nats-Msg-Id/msgID", async () => {
    await publishInvokeRequestEvent(baseArgs);
    const firstMsgId = fakeHeaders.get("Nats-Msg-Id");
    fakeHeaders.clear();
    await publishInvokeRequestEvent(baseArgs);
    const secondMsgId = fakeHeaders.get("Nats-Msg-Id");
    expect(firstMsgId).toBe(secondMsgId);
    expect(publishSpy).toHaveBeenCalledTimes(2);
    const firstOpts = publishSpy.mock.calls[0]![2] as { msgID: string };
    const secondOpts = publishSpy.mock.calls[1]![2] as { msgID: string };
    expect(firstOpts.msgID).toBe(secondOpts.msgID);
  });

  it("sets x-yoizen-tenant header to tenantId", async () => {
    await publishInvokeRequestEvent(baseArgs);
    expect(fakeHeaders.get("x-yoizen-tenant")).toBe("tenant-abc");
  });

  it("envelope payload carries connectorId/endpointId/args", async () => {
    await publishInvokeRequestEvent(baseArgs);
    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    expect(envelope.data.payload["connectorId"]).toBe("adp-1");
    expect(envelope.data.payload["endpointId"]).toBe("ep-1");
    expect(envelope.data.payload["args"]).toEqual(baseArgs.args);
  });

  it("resolves err(...) and never falls back to core-NATS publish when the broker rejects (fail-loud, no silent fallback)", async () => {
    publishSpy.mockImplementationOnce(async () => {
      throw new Error("no stream matches subject");
    });
    const result = await publishInvokeRequestEvent(baseArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("no stream matches subject");
    }
    // The fail-loud contract: never silently degrade to a core-NATS publish
    // for this subject (unlike service-bus.activity.ts's fallback).
    expect(corePublishSpy).not.toHaveBeenCalled();
  });

  it("threads args.webhook into the envelope payload when provided (T05)", async () => {
    await publishInvokeRequestEvent({
      ...baseArgs,
      webhook: { url: "https://caller.example/hook", headers: { "x-a": "b" } },
    });
    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    expect(envelope.data.payload["webhook"]).toEqual({
      url: "https://caller.example/hook",
      headers: { "x-a": "b" },
    });
  });

  it("omits webhook from the payload when not provided", async () => {
    await publishInvokeRequestEvent(baseArgs);
    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    expect(envelope.data.payload["webhook"]).toBeUndefined();
  });
});

// DESIGN CHANGE (2026-07-14, T05): `assertInvokeSubjectStreamBound` is now a
// JetStream connectivity probe over `streams.list()`, not a per-subject
// `streams.find()` check — see the module header + function doc comment for
// why a per-tenant guarantee is impossible at boot once invoke subjects ride
// the per-tenant `INGRESS-<tenant>` streams instead of a dedicated stream.
describe("assertInvokeSubjectStreamBound", () => {
  beforeEach(() => {
    listSpy.mockClear();
    fakeStreamNames = ["INGRESS-acme"];
  });
  afterEach(() => {
    listSpy.mockClear();
  });

  it("resolves when at least one INGRESS-<tenant> stream is found", async () => {
    fakeStreamNames = ["INGRESS-acme", "GATEWAY_AUDIT"];
    await expect(assertInvokeSubjectStreamBound()).resolves.toBeUndefined();
  });

  it("resolves (warns, does not throw) when JetStream is reachable but no INGRESS-<tenant> stream exists yet (fresh cluster)", async () => {
    fakeStreamNames = ["GATEWAY_AUDIT"];
    await expect(assertInvokeSubjectStreamBound()).resolves.toBeUndefined();
  });

  it("throws (fails loud) when JetStream itself is unreachable", async () => {
    listSpy.mockImplementationOnce(() => ({
      [Symbol.asyncIterator]: async function* () {
        throw new Error("connection refused");
      },
    }));
    await expect(assertInvokeSubjectStreamBound()).rejects.toThrow(
      /cannot reach JetStream/
    );
  });
});

describe("buildInvokeRequestedSubject", () => {
  it("builds the canonical 8-token subject", () => {
    expect(buildInvokeRequestedSubject("acme")).toBe(
      "evt.acme.connector-runtime.platform.endpoint.system.invoke_requested.v1"
    );
  });
});

describe("publishInvokeCompletedEvent", () => {
  beforeEach(() => {
    publishSpy.mockClear();
    fakeHeaders.clear();
  });
  afterEach(() => {
    publishSpy.mockClear();
    fakeHeaders.clear();
  });

  const completedArgs = {
    tenantId: "tenant-abc",
    invocationId: "inv-1",
    connectorId: "adp-1",
    endpointId: "ep-1",
    record: {
      status: "completed" as const,
      tenantId: "tenant-abc",
      invocationId: "inv-1",
      completedAt: "2026-07-14T00:00:00.000Z",
      outcome: "ok" as const,
      result: { status: 200, data: { ok: true }, headers: {} },
    },
    causal: {
      correlation_id: "corr-1",
      causation_id: "cause-1",
      depth: 0,
    },
  };

  it("publishes to the invoke_completed subject", async () => {
    const result = await publishInvokeCompletedEvent(completedArgs);
    expect(result.ok).toBe(true);
    const subject = publishSpy.mock.calls[0]![0] as string;
    expect(subject).toBe(
      "evt.tenant-abc.connector-runtime.platform.endpoint.system.invoke_completed.v1"
    );
  });

  it("sets Nats-Msg-Id to completed:<invocationId>", async () => {
    await publishInvokeCompletedEvent(completedArgs);
    expect(fakeHeaders.get("Nats-Msg-Id")).toBe("completed:inv-1");
  });

  it("threads the causal correlation/causation from the original invoke_requested envelope", async () => {
    await publishInvokeCompletedEvent(completedArgs);
    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      correlation_id: string;
      causation_id: string;
    };
    expect(envelope.correlation_id).toBe("corr-1");
    expect(envelope.causation_id).toBe("cause-1");
  });

  it("resolves err(...) (best-effort, never falls back to core-NATS) when the broker rejects", async () => {
    publishSpy.mockImplementationOnce(async () => {
      throw new Error("broker down");
    });
    const result = await publishInvokeCompletedEvent(completedArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("broker down");
    }
  });
});
