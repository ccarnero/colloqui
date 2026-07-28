import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { setActiveRedisInstance } from "../helpers/fake-adapter-redis";
import { setActivePublishSpy } from "../helpers/fake-nats-jetstream";
import {
  setActiveTracedFetch,
  type TracedFetchImpl,
} from "../helpers/fake-traced-fetch";

const fakeAdapterConfig = {
  id: "adp-1",
  tenantId: "t1",
  name: "Test",
  context: "test",
  baseUrl: "https://api.example.com",
  authType: "api-key",
  authConfig: { apiKey: "secret-key", apiKeyHeader: "X-API-Key" },
  headers: [{ key: "X-Custom", value: "yes" }],
  timeoutMs: 5000,
  maxRetries: 1,
  retryBackoffMs: 10,
  healthCheckPath: "/health",
  status: "enabled",
  defaultCache: {
    enabled: true,
    ttlSeconds: 30,
    methods: ["GET"],
  },
  endpoints: [
    {
      id: "ep-1",
      adapterId: "adp-1",
      label: "Get",
      method: "GET",
      path: "/data",
      cache: {
        enabled: true,
        ttlSeconds: 45,
        methods: ["GET"],
      },
    },
  ],
};

const cachedEntry = JSON.stringify({
  data: fakeAdapterConfig,
  softExpiresAt: Date.now() + 120_000,
});

const mockRedisInstance = {
  get: mock((key: string) => {
    if (key.startsWith("adapter:config:")) {
      return Promise.resolve(cachedEntry);
    }
    return Promise.resolve(null);
  }),
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
// `service-call.activity.spec.ts`).
setActiveRedisInstance(mockRedisInstance);

// `tracedFetch` is routed through the SHARED `"@yoizen/observability"` double
// (`test/helpers/fake-traced-fetch`) instead of a private `mock.module(...)`
// here — see that file's doc comment: `adapter-client.provider.ts`'s
// `getAdapterClient()` singleton captures `tracedFetch` at module-eval time,
// only ONCE across the whole `bun test` process, so a private mock here would
// silently lose the binding race against other spec files that also exercise
// `getAdapterClient()` (e.g. `service-call.activity.spec.ts`).
const tracedFetchMock: ReturnType<typeof mock> = mock(() =>
  Promise.resolve(
    new Response(JSON.stringify({ result: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
);
setActiveTracedFetch(tracedFetchMock as unknown as TracedFetchImpl);

// `endpoint-call.activity.ts` imports the REAL `publishEndpointCallEvent`
// (`./_shared/event-publisher`) and calls it (fire-and-forget) after every
// `executeEndpointCallCore` run — that module lazily dials real NATS
// (`getConnection()` -> `connect()`) the first time it is invoked. Without
// mocking `"nats"`, every test below triggers a REAL TCP connect attempt to
// `nats://localhost:4222` (`workflowHttpWorkerConfig.natsUrl` default),
// which — since `localhost` resolves to both an IPv4 and IPv6 address —
// races Node's happy-eyeballs `internalConnectMultipleTimeout` and surfaces
// as `TypeError: null is not an object (evaluating 'context')` several
// seconds later as an "Unhandled error between tests" (root cause, see
// `manual-loops/connector-invoke-api.md` T05 follow-up).
//
// This uses the SHARED `"nats"` double from `test/helpers/fake-nats-jetstream`
// instead of a private `mock.module("nats", ...)` here — see that file's doc
// comment for why: `event-publisher.ts` is an ES module singleton evaluated
// only ONCE across the whole `bun test` process (this file and
// `event-publisher.spec.ts` both import it), so whichever spec file's own
// private `"nats"` mock happened to be active at that ONE evaluation would
// win FOREVER, silently starving the other file's `publishSpy` assertions.
setActivePublishSpy(mock(async () => ({ seq: 1 })));

const { executeEndpointCall } = await import(
  "../../src/activities/endpoint-call.activity"
);

describe("executeEndpointCall", () => {
  beforeEach(() => {
    // Re-assert on every test, not just once at module-eval time: another
    // spec file's `beforeEach` may have re-pointed the SHARED active-fetch
    // cell (`fake-traced-fetch.ts`) at its own mock in between test runs.
    setActiveTracedFetch(tracedFetchMock as unknown as TracedFetchImpl);
    setActiveRedisInstance(mockRedisInstance);
    tracedFetchMock.mockReset();
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ result: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
  });

  it("should use raw URL when no adapterId is provided", async () => {
    const result = await executeEndpointCall(
      { method: "GET", url: "https://raw.example.com/api" },
      "t1"
    );

    expect(result.status).toBe(200);
    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
    const [url] = tracedFetchMock.mock.calls[0];
    expect(url).toBe("https://raw.example.com/api");
  });

  it("should resolve via adapter when adapterId and endpointId are present", async () => {
    const result = await executeEndpointCall(
      {
        method: "GET",
        url: "https://fallback.example.com",
        adapterId: "adp-1",
        endpointId: "ep-1",
      },
      "t1"
    );

    expect(result.status).toBe(200);
    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = tracedFetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/data");
    expect(init.headers["X-API-Key"]).toBe("secret-key");
    expect(init.headers["X-Custom"]).toBe("yes");
  });

  it("should retry on 5xx in adapter path", async () => {
    let callCount = 0;
    tracedFetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response("Server Error", { status: 500 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const result = await executeEndpointCall(
      {
        method: "GET",
        url: "https://fallback.example.com",
        adapterId: "adp-1",
        endpointId: "ep-1",
      },
      "t1"
    );

    expect(result.status).toBe(200);
    expect(tracedFetchMock).toHaveBeenCalledTimes(2);
  });

  it("should not retry on 4xx", async () => {
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "bad request" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await executeEndpointCall(
      {
        method: "GET",
        url: "https://fallback.example.com",
        adapterId: "adp-1",
        endpointId: "ep-1",
      },
      "t1"
    );

    expect(result.status).toBe(400);
    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
  });

  it("fast-fails with CIRCUIT_OPEN when the breaker denies (no HTTP call)", async () => {
    // One-shot deny. L1 cache makes subsequent tests that already
    // interacted with the breaker immune, so we toggle only for this
    // single assertion and then reset.
    mockRedisInstance.evalsha.mockImplementationOnce(() =>
      Promise.resolve(["deny", "open", "cooldown"])
    );

    let caught: unknown = null;
    try {
      await executeEndpointCall(
        { method: "GET", url: "https://cb-target.example.com/x" },
        "t-cb"
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect((caught as { type?: string }).type).toBe("CIRCUIT_OPEN");
    expect((caught as { nonRetryable?: boolean }).nonRetryable).toBe(false);
    expect(
      (caught as { nextRetryDelay?: unknown }).nextRetryDelay
    ).toBeDefined();
  });

  it("should append query params to URL", async () => {
    await executeEndpointCall(
      {
        method: "GET",
        url: "https://raw.example.com/api",
        params: { page: 1, q: "test" },
      },
      "t1"
    );

    const [url] = tracedFetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("q")).toBe("test");
  });

  it("resolves against the adapter baseUrl when endpointId is empty", async () => {
    const result = await executeEndpointCall(
      {
        method: "GET",
        url: "/eventit",
        adapterId: "adp-1",
        endpointId: "",
      },
      "t1"
    );

    expect(result.status).toBe(200);
    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = tracedFetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/eventit");
    expect(init.method).toBe("GET");
    expect(init.headers["X-Custom"]).toBe("yes");
    expect(init.headers["X-API-Key"]).toBe("secret-key");
  });

  it("adapter-base branch retries on 5xx using adapter retry policy", async () => {
    let callCount = 0;
    tracedFetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response("Server Error", { status: 500 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const result = await executeEndpointCall(
      { method: "GET", url: "/eventit", adapterId: "adp-1" },
      "t1"
    );

    expect(result.status).toBe(200);
    // maxRetries=1 on the fake adapter config → up to 2 attempts.
    expect(tracedFetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a clear non-retryable error when raw URL is relative", async () => {
    let caught: unknown = null;
    try {
      await executeEndpointCall({ method: "GET", url: "/eventit" }, "t1");
    } catch (err) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect((caught as { type?: string }).type).toBe(
      "INVALID_ENDPOINT_CALL_URL"
    );
    expect((caught as { nonRetryable?: boolean }).nonRetryable).toBe(true);
    expect(tracedFetchMock).not.toHaveBeenCalled();
  });

  it("throws INVALID_ENDPOINT_CALL_ARGS when adapterId is set but url is empty", async () => {
    let caught: unknown = null;
    try {
      await executeEndpointCall(
        { method: "GET", url: "", adapterId: "adp-1" },
        "t1"
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect((caught as { type?: string }).type).toBe(
      "INVALID_ENDPOINT_CALL_ARGS"
    );
    expect((caught as { nonRetryable?: boolean }).nonRetryable).toBe(true);
    expect(tracedFetchMock).not.toHaveBeenCalled();
  });
});
