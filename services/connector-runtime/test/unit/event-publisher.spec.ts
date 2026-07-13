import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ---- mock @yoizen/observability before any module import ----
mock.module("@yoizen/observability", () => ({
  getMeter: () => ({
    createCounter: () => ({ add() {} }),
    createHistogram: () => ({ record() {} }),
  }),
  logWithEnvelope: () => {},
  PinoLoggerService: class FakeLogger {
    log() {}
    warn(_msg: string) {}
    error() {}
  },
}));

// ---- mock @yoizen/shared with real-ish implementations ----
class FakeDepthExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepthExceededError";
  }
}

/** Set by individual tests to force `buildEventEnvelope` to simulate a depth breach. */
const depthState = { forceDepthExceeded: false };

mock.module("@yoizen/shared", () => ({
  platformServiceUrl: (name: string) => `http://${name}.svc`,
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
  buildEventEnvelope: (params: Record<string, unknown>) => {
    const depth = (params["depth"] as number | undefined) ?? 0;
    if (depthState.forceDepthExceeded && depth > 0) {
      throw new FakeDepthExceededError(
        `Causal depth ${depth} exceeds MAX_DEPTH`
      );
    }
    return {
      type: params["type"],
      source: params["source"],
      data: { payload: params["payload"] },
      tenant: params["tenant"],
      correlation_id: params["correlationId"] ?? "generated-correlation-id",
      causation_id: params["causationId"] ?? null,
      transport: { depth },
    };
  },
  DepthExceededError: FakeDepthExceededError,
  TENANT_HEADER: "x-yoizen-tenant",
}));

// ---- fake JetStream publish spy ----
let publishSpy: ReturnType<typeof mock>;
let fakeHeaders: Map<string, string>;

mock.module("nats", () => {
  publishSpy = mock(async () => ({ seq: 1 }));
  fakeHeaders = new Map<string, string>();
  const hdrs = {
    set: (k: string, v: string) => fakeHeaders.set(k, v),
    get: (k: string) => fakeHeaders.get(k),
  };
  return {
    connect: mock(async () => ({
      isClosed: () => false,
      jetstream: () => ({ publish: publishSpy }),
    })),
    headers: () => hdrs,
  };
});

// Import AFTER all mocks are in place
const { publishEndpointCallEvent } = await import(
  "../../src/activities/_shared/event-publisher"
);

// Helper to flush micro-task queue so fire-and-forget publishes settle
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("publishEndpointCallEvent", () => {
  beforeEach(() => {
    publishSpy.mockClear();
    fakeHeaders.clear();
    depthState.forceDepthExceeded = false;
  });

  afterEach(() => {
    publishSpy.mockClear();
    fakeHeaders.clear();
    depthState.forceDepthExceeded = false;
  });

  const baseEvt = {
    tenantId: "tenant-abc",
    adapterId: "adp-1",
    endpointId: "ep-x",
    method: "GET",
    resolvedUrl: "https://api.example.com/data",
    status: 200,
    durationMs: 42,
    cacheResult: "hit" as const,
  };

  it("publishes with the correct subject pattern", async () => {
    publishEndpointCallEvent(baseEvt);
    await flush();

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const subject = publishSpy.mock.calls[0]![0] as string;
    expect(subject).toBe(
      "evt.tenant-abc.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1"
    );
  });

  it("envelope type is connector.endpoint_call.completed.v1", async () => {
    publishEndpointCallEvent(baseEvt);
    await flush();

    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      type: string;
      data: { payload: Record<string, unknown> };
    };
    expect(envelope.type).toBe("connector.endpoint_call.completed.v1");
  });

  it("envelope data.payload has the expected fields", async () => {
    publishEndpointCallEvent(baseEvt);
    await flush();

    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    const p = envelope.data.payload;
    expect(p["adapterId"]).toBe("adp-1");
    expect(p["endpointId"]).toBe("ep-x");
    expect(p["method"]).toBe("GET");
    expect(p["resolvedUrl"]).toBe("https://api.example.com/data");
    expect(p["status"]).toBe(200);
    expect(p["durationMs"]).toBe(42);
    expect(p["cacheResult"]).toBe("hit");
  });

  it("sets x-yoizen-tenant header to tenantId", async () => {
    publishEndpointCallEvent(baseEvt);
    await flush();

    expect(fakeHeaders.get("x-yoizen-tenant")).toBe("tenant-abc");
  });

  it("truncates resolvedUrl longer than 2048 chars", async () => {
    const longUrl = "https://api.example.com/" + "x".repeat(2048);
    publishEndpointCallEvent({ ...baseEvt, resolvedUrl: longUrl });
    await flush();

    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    const url = envelope.data.payload["resolvedUrl"] as string;
    expect(url.length).toBe(2049); // 2048 chars + ellipsis char
    expect(url.endsWith("…")).toBe(true);
  });

  it("includes requestHeaders in payload when provided", async () => {
    const evt = {
      ...baseEvt,
      requestHeaders: {
        "content-type": "application/json",
        authorization: "[REDACTED]",
      },
    };
    publishEndpointCallEvent(evt);
    await flush();

    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    const p = envelope.data.payload;
    expect(p["requestHeaders"]).toEqual({
      "content-type": "application/json",
      authorization: "[REDACTED]",
    });
  });

  it("includes requestBody in payload when provided", async () => {
    const evt = { ...baseEvt, requestBody: '{"key":"value"}' };
    publishEndpointCallEvent(evt);
    await flush();

    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    const p = envelope.data.payload;
    expect(p["requestBody"]).toBe('{"key":"value"}');
  });

  it("includes responseHeaders in payload when provided", async () => {
    const evt = {
      ...baseEvt,
      responseHeaders: {
        "content-type": "application/json",
        "cache-control": "max-age=3600",
      },
    };
    publishEndpointCallEvent(evt);
    await flush();

    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    const p = envelope.data.payload;
    expect(p["responseHeaders"]).toEqual({
      "content-type": "application/json",
      "cache-control": "max-age=3600",
    });
  });

  it("includes responseBody in payload when provided", async () => {
    const evt = { ...baseEvt, responseBody: '{"result":"success"}' };
    publishEndpointCallEvent(evt);
    await flush();

    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    const p = envelope.data.payload;
    expect(p["responseBody"]).toBe('{"result":"success"}');
  });

  it("includes cacheKey and cacheTtlSeconds when provided", async () => {
    const evt = {
      ...baseEvt,
      cacheKey: "httpcache:v1:abc123def456",
      cacheTtlSeconds: 3600,
    };
    publishEndpointCallEvent(evt);
    await flush();

    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    const p = envelope.data.payload;
    expect(p["cacheKey"]).toBe("httpcache:v1:abc123def456");
    expect(p["cacheTtlSeconds"]).toBe(3600);
  });

  it("omits optional fields from payload when undefined", async () => {
    publishEndpointCallEvent(baseEvt);
    await flush();

    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      data: { payload: Record<string, unknown> };
    };
    const p = envelope.data.payload;
    expect("requestHeaders" in p).toBe(false);
    expect("requestBody" in p).toBe(false);
    expect("responseHeaders" in p).toBe(false);
    expect("responseBody" in p).toBe(false);
    expect("cacheKey" in p).toBe(false);
    expect("cacheTtlSeconds" in p).toBe(false);
  });

  it("does not throw when publish rejects", async () => {
    publishSpy.mockImplementationOnce(async () => {
      throw new Error("NATS unavailable");
    });

    // Should not throw
    expect(() => publishEndpointCallEvent(baseEvt)).not.toThrow();
    await flush();
    // No unhandled rejection — test passes if we reach here
  });

  it("with causal context: propagates correlationId, causationId, and depth + 1", async () => {
    const evt = {
      ...baseEvt,
      causal: {
        correlation_id: "run-correlation-id",
        causation_id: "parent-event-id",
        depth: 2,
      },
    };
    publishEndpointCallEvent(evt);
    await flush();

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      correlation_id: string;
      causation_id: string | null;
      transport: { depth: number };
    };
    expect(envelope.correlation_id).toBe("run-correlation-id");
    expect(envelope.causation_id).toBe("parent-event-id");
    expect(envelope.transport.depth).toBe(3);
  });

  it("without causal context: envelope gets a random correlation and null causation (root event)", async () => {
    publishEndpointCallEvent(baseEvt);
    await flush();

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      correlation_id: string;
      causation_id: string | null;
      transport: { depth: number };
    };
    expect(envelope.correlation_id).toBe("generated-correlation-id");
    expect(envelope.causation_id).toBeNull();
    expect(envelope.transport.depth).toBe(0);
  });

  it("falls back to a root event when buildEventEnvelope throws DepthExceededError", async () => {
    depthState.forceDepthExceeded = true;
    const evt = {
      ...baseEvt,
      causal: {
        correlation_id: "run-correlation-id",
        causation_id: "parent-event-id",
        depth: 50,
      },
    };

    publishEndpointCallEvent(evt);
    await flush();

    // Publish still happens (fallback root envelope), never fails silently.
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      correlation_id: string;
      causation_id: string | null;
      transport: { depth: number };
    };
    // Fallback envelope is built without causal fields → root event.
    expect(envelope.correlation_id).toBe("generated-correlation-id");
    expect(envelope.causation_id).toBeNull();
    expect(envelope.transport.depth).toBe(0);
  });
});
