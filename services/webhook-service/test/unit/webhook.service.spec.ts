import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { WebhookService } from "../../src/modules/webhook/webhook.service";
import {
  JETSTREAM_CONSUMER,
  JETSTREAM_PUBLISHER,
} from "../../src/providers/nats.provider";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";
import {
  WEBHOOK_DLQ_SUBJECT,
  WEBHOOK_MAX_RETRIES,
} from "@yoizen/shared";
import type { AdapterConfig, CompletionEvent } from "@yoizen/shared";

const fakeAdapter: AdapterConfig = {
  id: "adp-1",
  tenantId: "t1",
  name: "Test",
  context: "test",
  baseUrl: "https://api.example.com",
  authType: "api-key",
  authConfig: { apiKey: "secret-key", apiKeyHeader: "X-API-Key" },
  headers: [{ key: "X-Custom", value: "yes" }],
  timeoutMs: 3000,
  maxRetries: 2,
  retryBackoffMs: 10,
  healthCheckPath: "/health",
  status: "active",
  endpoints: [],
};

let tracedFetchMock: ReturnType<typeof mock>;

mock.module("@yoizen/observability", () => {
  tracedFetchMock = mock(() =>
    Promise.resolve(new Response("OK", { status: 200 })),
  );
  return { tracedFetch: tracedFetchMock };
});

function buildMockRedis() {
  const adapterKey = "adapter:config:t1:adp-1";
  const cachedEntry = JSON.stringify({
    data: fakeAdapter,
    softExpiresAt: Date.now() + 60_000,
  });

  return {
    get: mock((key: string) => {
      if (key === adapterKey) return Promise.resolve(cachedEntry);
      return Promise.resolve(null);
    }),
    setex: mock(() => Promise.resolve("OK")),
    del: mock((..._keys: string[]) => Promise.resolve(0)),
  };
}

function makeCompletion(overrides: Partial<CompletionEvent> = {}): CompletionEvent {
  return {
    eventId: "evt-1",
    type: "created",
    result: {
      eventId: "evt-1",
      type: "created",
      processed: true,
      timestamp: Date.now(),
    },
    callback_url: "https://callback.example.com/hook",
    ...overrides,
  };
}

describe("WebhookService", () => {
  let service: WebhookService;
  let mockPublisher: { publish: ReturnType<typeof mock> };

  beforeEach(async () => {
    tracedFetchMock.mockReset();
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(new Response("OK", { status: 200 })),
    );

    const mockConsumer = {
      consume: mock(() =>
        Promise.resolve({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ done: true, value: undefined }),
          }),
          stop: mock(),
        }),
      ),
    };

    mockPublisher = {
      publish: mock(() => Promise.resolve()),
    };

    const module = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: JETSTREAM_CONSUMER, useValue: mockConsumer },
        { provide: JETSTREAM_PUBLISHER, useValue: mockPublisher },
        { provide: REDIS_CLIENT, useValue: buildMockRedis() },
      ],
    }).compile();

    service = module.get(WebhookService);
  });

  it("should use default retries when no adapter_id", async () => {
    const completion = makeCompletion();

    await (service as any).dispatchWithRetry(completion, "t1");

    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
    const [, init] = tracedFetchMock.mock.calls[0];
    expect(init.headers["X-API-Key"]).toBeUndefined();
  });

  it("should use adapter auth and headers when adapter_id is present", async () => {
    const completion = makeCompletion({ adapter_id: "adp-1" });

    await (service as any).dispatchWithRetry(completion, "t1");

    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
    const [, init] = tracedFetchMock.mock.calls[0];
    expect(init.headers["X-API-Key"]).toBe("secret-key");
    expect(init.headers["X-Custom"]).toBe("yes");
  });

  it("should fall back to defaults when adapter fetch fails", async () => {
    const failRedis = {
      get: mock(() => Promise.resolve(null)),
      setex: mock(() => Promise.resolve("OK")),
      del: mock((..._keys: string[]) => Promise.resolve(0)),
    };

    const failFetch = mock((url: string) => {
      if (url.includes("/adapters/")) {
        return Promise.resolve(new Response("Error", { status: 500 }));
      }
      return Promise.resolve(new Response("OK", { status: 200 }));
    });

    mock.module("@yoizen/observability", () => ({
      tracedFetch: failFetch,
    }));

    const mockConsumer = {
      consume: mock(() =>
        Promise.resolve({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ done: true, value: undefined }),
          }),
          stop: mock(),
        }),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: JETSTREAM_CONSUMER, useValue: mockConsumer },
        { provide: JETSTREAM_PUBLISHER, useValue: { publish: mock(() => Promise.resolve()) } },
        { provide: REDIS_CLIENT, useValue: failRedis },
      ],
    }).compile();

    const svc = module.get(WebhookService);
    const completion = makeCompletion({ adapter_id: "adp-1" });

    await (svc as any).dispatchWithRetry(completion, "t1");
  });

  it("should inject correct auth headers for each type", async () => {
    const types: Array<{ authType: string; authConfig: Record<string, unknown>; expectedKey: string; expectedValue: string }> = [
      {
        authType: "api-key",
        authConfig: { apiKey: "k1", apiKeyHeader: "X-Key" },
        expectedKey: "X-Key",
        expectedValue: "k1",
      },
      {
        authType: "bearer",
        authConfig: { bearerToken: "tok" },
        expectedKey: "Authorization",
        expectedValue: "Bearer tok",
      },
      {
        authType: "basic",
        authConfig: { basicUsername: "u", basicPassword: "p" },
        expectedKey: "Authorization",
        expectedValue: `Basic ${btoa("u:p")}`,
      },
    ];

    for (const { authType, authConfig, expectedKey, expectedValue } of types) {
      const adapter = { ...fakeAdapter, authType, authConfig };
      const headers: Record<string, string> = {};
      (service as any).injectAuthHeaders(adapter, headers);
      expect(headers[expectedKey]).toBe(expectedValue);
    }
  });

  it("should publish to DLQ when all retries exhausted", async () => {
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(new Response("Error", { status: 502 })),
    );

    const completion = makeCompletion();

    await (service as any).dispatchWithRetry(completion, "t1");

    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
    const [subject] = mockPublisher.publish.mock.calls[0];
    expect(subject).toBe(WEBHOOK_DLQ_SUBJECT);
  });
});
