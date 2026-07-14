import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ---- mock @yoizen/observability before any module import ----
mock.module("@yoizen/observability", () => ({
  getMeter: () => ({
    createCounter: () => ({ add() {} }),
    createHistogram: () => ({ record() {} }),
  }),
  logWithEnvelope: () => {},
  injectTraceContext: () => {},
  PinoLoggerService: class FakeLogger {
    log() {}
    warn() {}
    error() {}
  },
}));

// ---- mock @yoizen/shared with real-ish implementations ----
mock.module("@yoizen/shared", () => ({
  platformServiceUrl: (name: string) => `http://${name}.svc`,
  RATE_LIMIT_DEFAULT_LIMIT: 100,
  RATE_LIMIT_DEFAULT_WINDOW_MS: 60_000,
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
  buildEventEnvelope: (params: Record<string, unknown>) => ({
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

// ---- fake JetStream publish spy + JetStreamManager.streams.find spy ----
let publishSpy: ReturnType<typeof mock>;
let findSpy: ReturnType<typeof mock>;
let corePublishSpy: ReturnType<typeof mock>;
let fakeHeaders: Map<string, string>;

mock.module("nats", () => {
  publishSpy = mock(async () => ({ seq: 1 }));
  findSpy = mock(async () => "CONNECTOR-INVOKE");
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
      jetstreamManager: async () => ({ streams: { find: findSpy } }),
      publish: corePublishSpy,
      flush: async () => {},
    })),
    headers: () => hdrs,
  };
});

// Import AFTER all mocks are in place
const {
  publishInvokeRequestEvent,
  assertInvokeSubjectStreamBound,
  buildInvokeRequestedSubject,
} = await import("../../src/activities/_shared/invoke-request-publisher");

describe("publishInvokeRequestEvent", () => {
  beforeEach(() => {
    publishSpy.mockClear();
    findSpy.mockClear();
    corePublishSpy.mockClear();
    fakeHeaders.clear();
  });

  afterEach(() => {
    publishSpy.mockClear();
    findSpy.mockClear();
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
});

describe("assertInvokeSubjectStreamBound", () => {
  beforeEach(() => {
    findSpy.mockClear();
  });
  afterEach(() => {
    findSpy.mockClear();
  });

  it("resolves when the broker reports a bound stream", async () => {
    findSpy.mockImplementationOnce(async () => "CONNECTOR-INVOKE");
    await expect(assertInvokeSubjectStreamBound()).resolves.toBeUndefined();
  });

  it("throws (fails loud) when the subject is not bound to any stream", async () => {
    findSpy.mockImplementationOnce(async () => {
      throw new Error("no stream matches subject");
    });
    await expect(assertInvokeSubjectStreamBound()).rejects.toThrow(
      /not bound to a JetStream stream/
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
