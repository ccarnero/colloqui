import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdapterEnrichmentStage } from "../../src/pipeline/adapter-enrichment.stage";
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
  maxRetries: 1,
  retryBackoffMs: 100,
  healthCheckPath: "/health",
  status: "active",
  endpoints: [
    { id: "ep-1", adapterId: "adp-1", label: "Get", method: "GET", path: "/data" },
  ],
};

let tracedFetchMock: ReturnType<typeof mock>;

mock.module("@yoizen/observability", () => {
  tracedFetchMock = mock((_url: string, _init?: RequestInit) => {
    return Promise.resolve(
      new Response(JSON.stringify({ enrichedField: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
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

function makeEnvelope(
  overrides: Partial<EventEnvelope> & { id: string; type: string },
): EventEnvelope {
  const { id, type } = overrides;
  return {
    specversion: "1.0",
    id,
    source: `events.${type}`,
    type,
    resource: type,
    time: new Date().toISOString(),
    traceid: id,
    causation_id: null,
    correlation_id: id,
    tenant: "t1",
    producer: "test",
    domain: "platform",
    channel: "events",
    provider: "test",
    accountid: "t1",
    idempotencykey: id,
    transport: { method: "stream", protocol: "internal" },
    data: {
      received_at: new Date().toISOString(),
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 0,
      payload_checksum: "",
      payload: {},
    },
    ...overrides,
  };
}

describe("AdapterEnrichmentStage", () => {
  let stage: AdapterEnrichmentStage;
  let mockRedis: ReturnType<typeof buildMockRedis>;

  const baseContext: PipelineContext = {
    subject: "events.created",
    tenantId: "t1",
  };

  beforeEach(async () => {
    mockRedis = buildMockRedis();

    const module = await Test.createTestingModule({
      providers: [
        AdapterEnrichmentStage,
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    stage = module.get(AdapterEnrichmentStage);
  });

  it("should pass through when enrich_adapter is absent", async () => {
    const envelope = makeEnvelope({
      id: "evt-1",
      type: "created",
      data: {
        received_at: new Date().toISOString(),
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "",
        payload: { data: true },
      },
    });

    const result = await stage.process(envelope, baseContext);
    expect(result).toEqual(envelope);
  });

  it("should pass through when tenantId is missing", async () => {
    const envelope = makeEnvelope({
      id: "evt-2",
      type: "created",
      data: {
        received_at: new Date().toISOString(),
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "",
        payload: { data: true },
      },
      enrich_adapter: { adapterId: "adp-1", endpointId: "ep-1" },
    });

    const result = await stage.process(envelope, {
      subject: "events.created",
    });
    expect(result).toEqual(envelope);
  });

  it("should merge _enriched into data.payload on success", async () => {
    const envelope = makeEnvelope({
      id: "evt-3",
      type: "created",
      data: {
        received_at: new Date().toISOString(),
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "",
        payload: { original: true },
      },
      enrich_adapter: { adapterId: "adp-1", endpointId: "ep-1" },
    });

    const result = await stage.process(envelope, baseContext);

    expect(result.data.payload?._enriched).toEqual({ enrichedField: true });
    expect(result.data.payload?.original).toBe(true);
  });

  it("should pass through on non-2xx response", async () => {
    tracedFetchMock.mockImplementationOnce(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    );

    const envelope = makeEnvelope({
      id: "evt-4",
      type: "created",
      data: {
        received_at: new Date().toISOString(),
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "",
        payload: { data: true },
      },
      enrich_adapter: { adapterId: "adp-1", endpointId: "ep-1" },
    });

    const result = await stage.process(envelope, baseContext);
    expect(result.data.payload?._enriched).toBeUndefined();
  });

  it("should pass through on fetch exception", async () => {
    tracedFetchMock.mockImplementationOnce(() =>
      Promise.reject(new Error("network error")),
    );

    const envelope = makeEnvelope({
      id: "evt-5",
      type: "created",
      data: {
        received_at: new Date().toISOString(),
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "",
        payload: { data: true },
      },
      enrich_adapter: { adapterId: "adp-1", endpointId: "ep-1" },
    });

    const result = await stage.process(envelope, baseContext);
    expect(result.data.payload?._enriched).toBeUndefined();
  });
});
