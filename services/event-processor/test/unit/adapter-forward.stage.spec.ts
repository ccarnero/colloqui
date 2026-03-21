import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdapterForwardStage } from "../../src/pipeline/adapter-forward.stage";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";
import type { EventEnvelope } from "@yoizen/shared";
import type { PipelineContext } from "../../src/pipeline/pipeline-stage.interface";

const fakeAdapterConfig = {
  id: "adp-1",
  tenantId: "t1",
  name: "Test",
  context: "test",
  baseUrl: "https://api.example.com",
  authType: "none",
  authConfig: {},
  headers: [],
  timeoutMs: 5000,
  maxRetries: 2,
  retryBackoffMs: 10,
  healthCheckPath: "/health",
  status: "active",
  endpoints: [
    { id: "ep-1", adapterId: "adp-1", label: "Post", method: "POST", path: "/ingest" },
  ],
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
    data: fakeAdapterConfig,
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

describe("AdapterForwardStage", () => {
  let stage: AdapterForwardStage;

  const baseContext: PipelineContext = {
    subject: "events.created",
    tenantId: "t1",
  };

  beforeEach(async () => {
    tracedFetchMock.mockReset();
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(new Response("OK", { status: 200 })),
    );

    const module = await Test.createTestingModule({
      providers: [
        AdapterForwardStage,
        { provide: REDIS_CLIENT, useValue: buildMockRedis() },
      ],
    }).compile();

    stage = module.get(AdapterForwardStage);
  });

  it("should pass through when forwardAdapter is absent", async () => {
    const envelope: EventEnvelope = {
      id: "evt-1",
      type: "created",
      payload: { data: true },
    };

    const result = await stage.process(envelope, baseContext);
    expect(result).toEqual(envelope);
    expect(tracedFetchMock).not.toHaveBeenCalled();
  });

  it("should pass through when tenantId is missing", async () => {
    const envelope: EventEnvelope = {
      id: "evt-2",
      type: "created",
      payload: {},
      forwardAdapter: { adapterId: "adp-1", endpointId: "ep-1" },
    };

    const result = await stage.process(envelope, { subject: "events.created" });
    expect(result).toEqual(envelope);
  });

  it("should forward successfully on first attempt", async () => {
    const envelope: EventEnvelope = {
      id: "evt-3",
      type: "created",
      payload: { data: true },
      forwardAdapter: { adapterId: "adp-1", endpointId: "ep-1" },
    };

    const result = await stage.process(envelope, baseContext);

    expect(result).toEqual(envelope);
    expect(tracedFetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = tracedFetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/ingest");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Yoizen-Source"]).toBe("event-processor");
  });

  it("should retry on 5xx and succeed on attempt 2", async () => {
    let callCount = 0;
    tracedFetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response("Error", { status: 502 }));
      }
      return Promise.resolve(new Response("OK", { status: 200 }));
    });

    const envelope: EventEnvelope = {
      id: "evt-4",
      type: "created",
      payload: {},
      forwardAdapter: { adapterId: "adp-1", endpointId: "ep-1" },
    };

    const result = await stage.process(envelope, baseContext);
    expect(result).toEqual(envelope);
    expect(tracedFetchMock).toHaveBeenCalledTimes(2);
  });

  it("should stop on 4xx without retrying", async () => {
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(new Response("Bad Request", { status: 400 })),
    );

    const envelope: EventEnvelope = {
      id: "evt-5",
      type: "created",
      payload: {},
      forwardAdapter: { adapterId: "adp-1", endpointId: "ep-1" },
    };

    const result = await stage.process(envelope, baseContext);
    expect(result).toEqual(envelope);
    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
  });

  it("should return envelope unchanged when all retries exhausted", async () => {
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(new Response("Error", { status: 503 })),
    );

    const envelope: EventEnvelope = {
      id: "evt-6",
      type: "created",
      payload: { original: true },
      forwardAdapter: { adapterId: "adp-1", endpointId: "ep-1" },
    };

    const result = await stage.process(envelope, baseContext);
    expect(result.payload.original).toBe(true);
    expect(tracedFetchMock).toHaveBeenCalledTimes(3);
  });
});
