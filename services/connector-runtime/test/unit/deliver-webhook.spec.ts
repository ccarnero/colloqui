import { beforeEach, describe, expect, it, mock } from "bun:test";

// `webhook-delivery.ts` calls `tracedFetch` (`@yoizen/observability`), the
// SAME traced HTTP edge every other outbound call in this service uses —
// mocked here via `mock.module`, never by mutating the real global `fetch`.
// An earlier version of this test swapped `globalThis.fetch` directly,
// which corrupted OTHER test files' real network calls when run in the
// same `bun test` process (intermittent `internalConnectMultipleTimeout`
// crashes unrelated to this file — see git history); `mock.module` scopes
// the fake to imports of this specifier instead of the shared runtime global.
let tracedFetchMock: ReturnType<typeof mock>;

mock.module("@yoizen/observability", () => {
  tracedFetchMock = mock(async () => new Response("{}", { status: 200 }));
  return {
    tracedFetch: tracedFetchMock,
    getMeter: () => ({
      createCounter: () => ({ add() {} }),
      createHistogram: () => ({ record() {} }),
    }),
    startNatsProducerSpan: () => ({ span: { end() {} } }),
    startNatsConsumerSpan: () => ({ span: { end() {} } }),
    injectTraceContext: () => {},
    activeOrRandomTraceId: () => "trace-1",
    logWithEnvelope: () => {},
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
  };
});

const { deliverWebhook } = await import(
  "../../src/activities/_shared/webhook-delivery"
);

const completedRecord = {
  status: "completed" as const,
  tenantId: "acme",
  invocationId: "inv-1",
  completedAt: "2026-07-14T00:00:00.000Z",
  outcome: "ok" as const,
  result: { status: 200, data: { hello: "world" }, headers: {} },
};

describe("deliverWebhook", () => {
  beforeEach(() => {
    tracedFetchMock.mockReset();
    tracedFetchMock.mockImplementation(
      async () => new Response("{}", { status: 200 })
    );
  });

  it("POSTs the record as JSON and resolves ok on 2xx", async () => {
    const result = await deliverWebhook(
      { url: "https://caller.example/hook" },
      completedRecord
    );
    expect(result.ok).toBe(true);
    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = tracedFetchMock.mock.calls[0]!;
    expect(url).toBe("https://caller.example/hook");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(completedRecord);
  });

  it("merges caller-supplied headers", async () => {
    await deliverWebhook(
      { url: "https://caller.example/hook", headers: { "x-secret": "1" } },
      completedRecord
    );
    const [, init] = tracedFetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["x-secret"]).toBe("1");
  });

  it("resolves err(...) on a non-2xx response", async () => {
    tracedFetchMock.mockImplementationOnce(
      async () => new Response("boom", { status: 500 })
    );

    const result = await deliverWebhook(
      { url: "https://caller.example/hook" },
      completedRecord
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(500);
    }
  });

  it("resolves err(...) instead of throwing when tracedFetch rejects", async () => {
    tracedFetchMock.mockImplementationOnce(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const result = await deliverWebhook(
      { url: "https://caller.example/hook" },
      completedRecord
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("ECONNREFUSED");
    }
  });

  it("rejects a non-http(s) url without attempting tracedFetch (SSRF guard)", async () => {
    const result = await deliverWebhook(
      { url: "file:///etc/passwd" },
      completedRecord
    );
    expect(result.ok).toBe(false);
    expect(tracedFetchMock).not.toHaveBeenCalled();
  });

  // --- SSRF guard: private/loopback/link-local/metadata targets (T05 security fix) ---

  it.each([
    ["cloud metadata endpoint", "http://169.254.169.254/latest/meta-data"],
    ["localhost", "http://localhost:8080/hook"],
    ["loopback IPv4", "http://127.0.0.1/hook"],
    ["loopback IPv6", "http://[::1]/hook"],
    ["link-local", "http://169.254.1.1/hook"],
    ["RFC1918 10.0.0.0/8", "http://10.0.0.5/hook"],
    ["RFC1918 172.16.0.0/12", "http://172.16.0.5/hook"],
    ["RFC1918 192.168.0.0/16", "http://192.168.1.5/hook"],
  ])("blocks a webhook target on a %s address and never calls tracedFetch", async (_label, url) => {
    const result = await deliverWebhook({ url }, completedRecord);
    expect(result.ok).toBe(false);
    expect(tracedFetchMock).not.toHaveBeenCalled();
  });

  // --- header denylist (T05 security fix) ---

  it("strips hop-by-hop/identity headers from webhook.headers", async () => {
    await deliverWebhook(
      {
        url: "https://caller.example/hook",
        headers: {
          host: "evil.example",
          "content-length": "0",
          "transfer-encoding": "chunked",
          connection: "keep-alive",
          "x-custom": "keep-me",
        },
      },
      completedRecord
    );
    const [, init] = tracedFetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers.host).toBeUndefined();
    expect(headers["content-length"]).toBeUndefined();
    expect(headers["transfer-encoding"]).toBeUndefined();
    expect(headers.connection).toBeUndefined();
    expect(headers["x-custom"]).toBe("keep-me");
  });

  it("does not let caller headers override content-type", async () => {
    await deliverWebhook(
      {
        url: "https://caller.example/hook",
        headers: { "content-type": "text/plain" },
      },
      completedRecord
    );
    const [, init] = tracedFetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
  });

  it("keeps a caller-supplied authorization header (allowed, not hop-by-hop)", async () => {
    await deliverWebhook(
      {
        url: "https://caller.example/hook",
        headers: { authorization: "Bearer caller-token" },
      },
      completedRecord
    );
    const [, init] = tracedFetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer caller-token");
  });
});
