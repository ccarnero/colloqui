import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { setActiveRedisInstance } from "../helpers/fake-adapter-redis";
import { setActivePublishSpy } from "../helpers/fake-nats-jetstream";
import {
  setActiveTracedFetch,
  type TracedFetchImpl,
} from "../helpers/fake-traced-fetch";

// Mirrors `endpoint-call.activity.spec.ts`'s mocking pattern: the REAL
// `AdapterClient` (via `getAdapterClient()`) and breaker run against faked
// Redis + `tracedFetch` edges only.
const mockRedisInstance = {
  get: mock((_key: string) => Promise.resolve(null)),
  setex: mock(() => Promise.resolve("OK")),
  del: mock((..._keys: string[]) => Promise.resolve(0)),
  script: mock(() => Promise.resolve("sha-fake")),
  evalsha: mock(() => Promise.resolve(["allow", "closed", ""])),
  eval: mock(() => Promise.resolve(["allow", "closed", ""])),
  options: {},
  status: "ready",
};

// `ioredis` is routed through the SHARED double (`test/helpers/fake-adapter-redis`)
// instead of a private `mock.module(...)` here — see that helper's doc
// comment: `adapter-client.provider.ts`'s `getRedis()` constructs exactly ONE
// `Redis` instance for the whole process, so a private mock here would
// silently lose the binding race against other spec files that also exercise
// `getAdapterClient()` (confirmed empirically against
// `endpoint-call-core.spec.ts`).
setActiveRedisInstance(mockRedisInstance);

/**
 * Fake mirror adapter config returned for `context=internal&name=echo-service`
 * lookups (`AdapterClient.findInternalByServiceId` → `GET /connectors?...`).
 */
const mirrorAdapterConfig = {
  id: "internal-adp-1",
  tenantId: "t1",
  name: "echo-service",
  context: "internal",
  baseUrl: "https://echo.svc.cluster.local",
  authType: "none",
  authConfig: {},
  headers: [{ key: "X-Mirror", value: "yes" }],
  timeoutMs: 5000,
  maxRetries: 1,
  retryBackoffMs: 10,
  healthCheckPath: "/health",
  status: "enabled",
  defaultCache: { enabled: false, ttlSeconds: 0, methods: [] },
  endpoints: [],
};

let tracedFetchMock: ReturnType<typeof mock>;

/** Default fetch router: mirror lookup by name, everything else 200 JSON. */
function defaultFetchImpl(url: string) {
  if (url.includes("/connectors?")) {
    if (url.includes("name=echo-service")) {
      return Promise.resolve(
        new Response(JSON.stringify([mirrorAdapterConfig]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    // No mirror: registry-fallback path
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
  if (url.includes("/services/")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          knativeName: "no-mirror-service",
          namespace: "tenant-ns",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
  }
  return Promise.resolve(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

// `tracedFetch` is routed through the SHARED `"@yoizen/observability"` double
// (`test/helpers/fake-traced-fetch`) instead of a private `mock.module(...)`
// here — see that helper's doc comment: `adapter-client.provider.ts`'s
// `getAdapterClient()` singleton captures `tracedFetch` at module-eval time,
// only ONCE across the whole `bun test` process, so a private mock here would
// silently lose the binding race against other spec files that also exercise
// `getAdapterClient()` (confirmed empirically against
// `endpoint-call.activity.spec.ts`).
tracedFetchMock = mock((url: string) => defaultFetchImpl(url));
setActiveTracedFetch(tracedFetchMock as unknown as TracedFetchImpl);

// See `endpoint-call.activity.spec.ts` / `fake-nats-jetstream.ts` doc
// comments: `event-publisher.ts` is an ES module singleton evaluated once
// across the whole `bun test` process, so the shared `"nats"` double + a
// mutable publish-spy indirection is required instead of a private
// `mock.module("nats", ...)` in this file.
let publishSpy: ReturnType<typeof mock>;

const { executeServiceCall } = await import(
  "../../src/activities/service-call.activity"
);

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function decodePublishedPayload(): Record<string, unknown> {
  const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
  const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
    resource: string;
    correlation_id: string;
    causation_id: string | null;
    transport: { depth: number };
    data: { payload: Record<string, unknown> };
  };
  return { ...envelope.data.payload, __resource: envelope.resource };
}

describe("executeServiceCall — endpoint_call_completed emission", () => {
  beforeEach(() => {
    publishSpy = mock(async () => ({ seq: 1 }));
    setActivePublishSpy(publishSpy);
    // Re-assert on every test, not just once at module-eval time: another
    // spec file's `beforeEach` may have re-pointed the SHARED active-fetch
    // cell (`fake-traced-fetch.ts`) at its own mock in between test runs.
    setActiveTracedFetch(tracedFetchMock as unknown as TracedFetchImpl);
    setActiveRedisInstance(mockRedisInstance);
    tracedFetchMock.mockReset();
    tracedFetchMock.mockImplementation((url: string) => defaultFetchImpl(url));
    mockRedisInstance.evalsha.mockReset();
    mockRedisInstance.evalsha.mockImplementation(() =>
      Promise.resolve(["allow", "closed", ""])
    );
  });

  it("publishes an event with causal context threaded through (mirror path)", async () => {
    const causal = {
      correlation_id: "run-correlation-id",
      causation_id: "parent-event-id",
      depth: 1,
    };

    await executeServiceCall(
      {
        serviceId: "svc-echo-uuid",
        serviceSlug: "echo-service",
        path: "/ping",
        method: "GET",
      },
      "t1",
      causal
    );
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
    expect(envelope.transport.depth).toBe(2);
  });

  it("publishes a root event when no causal context is passed", async () => {
    await executeServiceCall(
      {
        serviceId: "svc-echo-uuid",
        serviceSlug: "echo-service",
        path: "/ping",
        method: "GET",
      },
      "t1"
    );
    await flush();

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      causation_id: string | null;
      transport: { depth: number };
    };
    expect(envelope.causation_id).toBeNull();
    expect(envelope.transport.depth).toBe(0);
  });

  it("uses resource service/<serviceName>", async () => {
    await executeServiceCall(
      {
        serviceId: "svc-echo-uuid",
        serviceSlug: "echo-service",
        path: "/ping",
        method: "GET",
      },
      "t1"
    );
    await flush();

    const payload = decodePublishedPayload();
    expect(payload["__resource"]).toBe("service/echo-service");
  });

  it("redacts sensitive request headers before publishing", async () => {
    await executeServiceCall(
      {
        serviceId: "svc-echo-uuid",
        serviceSlug: "echo-service",
        path: "/ping",
        method: "GET",
        headers: { Authorization: "Bearer super-secret-token" },
      },
      "t1"
    );
    await flush();

    const payload = decodePublishedPayload();
    const requestHeaders = payload["requestHeaders"] as Record<string, string>;
    expect(requestHeaders["Authorization"]).toBe("[REDACTED]");
  });

  it("truncates an oversized request body before publishing", async () => {
    const bigValue = "x".repeat(9000);
    await executeServiceCall(
      {
        serviceId: "svc-echo-uuid",
        serviceSlug: "echo-service",
        path: "/ping",
        method: "POST",
        data: { big: bigValue },
      },
      "t1"
    );
    await flush();

    const payload = decodePublishedPayload();
    const requestBody = payload["requestBody"] as string;
    expect(requestBody.length).toBe(8192);
  });

  it("still emits when the upstream returns a non-2xx status", async () => {
    tracedFetchMock.mockImplementation((url: string) => {
      if (url.includes("/connectors?") && url.includes("name=echo-service")) {
        return Promise.resolve(
          new Response(JSON.stringify([mirrorAdapterConfig]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const result = await executeServiceCall(
      {
        serviceId: "svc-echo-uuid",
        serviceSlug: "echo-service",
        path: "/missing",
        method: "GET",
      },
      "t1"
    );
    await flush();

    expect(result.status).toBe(404);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const payload = decodePublishedPayload();
    expect(payload["status"]).toBe(404);
  });

  it("does not throw when the publish sink rejects (fire-and-forget)", async () => {
    publishSpy.mockImplementationOnce(async () => {
      throw new Error("NATS unavailable");
    });

    let caught: unknown = null;
    try {
      await executeServiceCall(
        {
          serviceId: "svc-echo-uuid",
          serviceSlug: "echo-service",
          path: "/ping",
          method: "GET",
        },
        "t1"
      );
    } catch (err) {
      caught = err;
    }
    await flush();

    expect(caught).toBeNull();
  });

  it("publishes via the registry fallback path when no mirror exists", async () => {
    const result = await executeServiceCall(
      {
        serviceId: "svc-no-mirror",
        path: "/ping",
        method: "GET",
      },
      "t1"
    );
    await flush();

    expect(result.status).toBe(200);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const payload = decodePublishedPayload();
    expect(payload["__resource"]).toBe("service/svc-no-mirror");
  });
});
