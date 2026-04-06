import { describe, it, expect, beforeEach, mock } from "bun:test";

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
  status: "active",
  endpoints: [
    {
      id: "ep-1",
      adapterId: "adp-1",
      label: "Get",
      method: "GET",
      path: "/data",
    },
  ],
};

const cachedEntry = JSON.stringify({
  data: fakeAdapterConfig,
  softExpiresAt: Date.now() + 120_000,
});

const mockRedisInstance = {
  get: mock((key: string) => {
    if (key.startsWith("adapter:config:")) return Promise.resolve(cachedEntry);
    return Promise.resolve(null);
  }),
  setex: mock(() => Promise.resolve("OK")),
  del: mock((..._keys: string[]) => Promise.resolve(0)),
  options: {},
  status: "ready",
};

mock.module("ioredis", () => {
  return {
    default: class Redis {
      constructor() {
        return mockRedisInstance;
      }
    },
  };
});

let tracedFetchMock: ReturnType<typeof mock>;

mock.module("@yoizen/observability", () => {
  tracedFetchMock = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify({ result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  return { tracedFetch: tracedFetchMock };
});

const { executeEndpointCall } = await import(
  "../../src/activities/endpoint-call.activity"
);

describe("executeEndpointCall", () => {
  beforeEach(() => {
    tracedFetchMock.mockReset();
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ result: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  it("should use raw URL when no adapterId is provided", async () => {
    const result = await executeEndpointCall(
      { method: "GET", url: "https://raw.example.com/api" },
      "t1",
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
      "t1",
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
        }),
      );
    });

    const result = await executeEndpointCall(
      {
        method: "GET",
        url: "https://fallback.example.com",
        adapterId: "adp-1",
        endpointId: "ep-1",
      },
      "t1",
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
        }),
      ),
    );

    const result = await executeEndpointCall(
      {
        method: "GET",
        url: "https://fallback.example.com",
        adapterId: "adp-1",
        endpointId: "ep-1",
      },
      "t1",
    );

    expect(result.status).toBe(400);
    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
  });

  it("should append query params to URL", async () => {
    await executeEndpointCall(
      {
        method: "GET",
        url: "https://raw.example.com/api",
        params: { page: 1, q: "test" },
      },
      "t1",
    );

    const [url] = tracedFetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("q")).toBe("test");
  });
});
