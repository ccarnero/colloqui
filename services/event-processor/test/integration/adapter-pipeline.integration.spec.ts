import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import Redis from "ioredis";
import { connect, type NatsConnection, type JetStreamClient } from "nats";
import type { Server } from "bun";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForRedisKey(
  redis: Redis,
  key: string,
  timeoutMs = 15_000,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await redis.get(key);
    if (val !== null) return val;
    await sleep(250);
  }
  return null;
}

const ADAPTER_PORT = 19998;
const TARGET_PORT = 19999;

const fakeAdapterConfig = {
  id: "adp-integ",
  tenantId: "t1",
  name: "Integration Adapter",
  context: "test",
  baseUrl: `http://localhost:${TARGET_PORT}`,
  authType: "api-key",
  authConfig: { apiKey: "integ-key", apiKeyHeader: "X-API-Key" },
  headers: [{ key: "X-Custom", value: "integration" }],
  timeoutMs: 5000,
  maxRetries: 1,
  retryBackoffMs: 50,
  healthCheckPath: "/health",
  status: "active",
  endpoints: [
    { id: "ep-get", adapterId: "adp-integ", label: "Get", method: "GET", path: "/data" },
    { id: "ep-post", adapterId: "adp-integ", label: "Post", method: "POST", path: "/ingest" },
  ],
};

interface TargetHit {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

describe("event-processor adapter pipeline integration", () => {
  let app: NestFastifyApplication;
  let redis: Redis;
  let nc: NatsConnection;
  let js: JetStreamClient;
  let adapterServer: Server;
  let targetServer: Server;
  let targetHits: TargetHit[];

  beforeAll(async () => {
    process.env.ADAPTER_SERVICE_URL = `http://localhost:${ADAPTER_PORT}`;

    targetHits = [];

    adapterServer = Bun.serve({
      port: ADAPTER_PORT,
      fetch(req) {
        if (req.url.includes("/adapters/adp-integ")) {
          return new Response(JSON.stringify(fakeAdapterConfig), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    targetServer = Bun.serve({
      port: TARGET_PORT,
      async fetch(req) {
        const headers: Record<string, string> = {};
        req.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const body =
          req.method !== "GET" ? await req.json().catch(() => null) : null;
        targetHits.push({
          method: req.method,
          url: req.url,
          headers,
          body,
        });
        return new Response(JSON.stringify({ enriched: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    redis = new Redis({ host: "localhost", port: 6379 });
    nc = await connect({ servers: "nats://localhost:4222" });
    js = nc.jetstream();
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await nc.close();
    adapterServer.stop(true);
    targetServer.stop(true);
  });

  it("should enrich event payload via adapter endpoint", async () => {
    const eventId = `integ-enrich-${Date.now()}`;
    const payload = {
      id: eventId,
      type: "created",
      payload: { original: true },
      metadata: { tenantId: "t1" },
      enrichAdapter: { adapterId: "adp-integ", endpointId: "ep-get" },
    };

    await js.publish(
      "events.created",
      new TextEncoder().encode(JSON.stringify(payload)),
    );

    const raw = await waitForRedisKey(redis, `result:${eventId}`);
    expect(raw).not.toBeNull();

    const result = JSON.parse(raw!);
    expect(result.eventId).toBe(eventId);
    expect(result.processed).toBe(true);

    await redis.del(`result:${eventId}`);
  });

  it("should forward event to adapter endpoint with correct headers", async () => {
    targetHits.length = 0;
    const eventId = `integ-fwd-${Date.now()}`;
    const payload = {
      id: eventId,
      type: "created",
      payload: { forwardMe: true },
      metadata: { tenantId: "t1" },
      forwardAdapter: { adapterId: "adp-integ", endpointId: "ep-post" },
    };

    await js.publish(
      "events.created",
      new TextEncoder().encode(JSON.stringify(payload)),
    );

    const raw = await waitForRedisKey(redis, `result:${eventId}`);
    expect(raw).not.toBeNull();

    await sleep(500);

    const postHits = targetHits.filter((h) => h.method === "POST");
    expect(postHits.length).toBeGreaterThanOrEqual(1);
    const hit = postHits[0];
    expect(hit.headers["x-api-key"]).toBe("integ-key");
    expect(hit.headers["x-yoizen-source"]).toBe("event-processor");

    await redis.del(`result:${eventId}`);
  });

  it("should handle both enrichment and forwarding in order", async () => {
    targetHits.length = 0;
    const eventId = `integ-both-${Date.now()}`;
    const payload = {
      id: eventId,
      type: "created",
      payload: { data: true },
      metadata: { tenantId: "t1" },
      enrichAdapter: { adapterId: "adp-integ", endpointId: "ep-get" },
      forwardAdapter: { adapterId: "adp-integ", endpointId: "ep-post" },
    };

    await js.publish(
      "events.created",
      new TextEncoder().encode(JSON.stringify(payload)),
    );

    const raw = await waitForRedisKey(redis, `result:${eventId}`);
    expect(raw).not.toBeNull();

    await sleep(500);

    expect(targetHits.length).toBeGreaterThanOrEqual(2);

    await redis.del(`result:${eventId}`);
  });

  it("should still process event when target endpoint is unreachable", async () => {
    targetServer.stop(true);
    await sleep(100);

    const eventId = `integ-nofwd-${Date.now()}`;
    const payload = {
      id: eventId,
      type: "created",
      payload: { data: true },
      metadata: { tenantId: "t1" },
      forwardAdapter: { adapterId: "adp-integ", endpointId: "ep-post" },
    };

    await js.publish(
      "events.created",
      new TextEncoder().encode(JSON.stringify(payload)),
    );

    const raw = await waitForRedisKey(redis, `result:${eventId}`, 20_000);
    expect(raw).not.toBeNull();

    const result = JSON.parse(raw!);
    expect(result.processed).toBe(true);

    await redis.del(`result:${eventId}`);

    targetServer = Bun.serve({
      port: TARGET_PORT,
      async fetch(req) {
        const headers: Record<string, string> = {};
        req.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const body =
          req.method !== "GET" ? await req.json().catch(() => null) : null;
        targetHits.push({ method: req.method, url: req.url, headers, body });
        return new Response(JSON.stringify({ enriched: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });
  });

  it("should process event normally without adapter fields (backward compat)", async () => {
    const eventId = `integ-plain-${Date.now()}`;
    const payload = {
      id: eventId,
      type: "created",
      payload: { basic: true },
    };

    await js.publish(
      "events.created",
      new TextEncoder().encode(JSON.stringify(payload)),
    );

    const raw = await waitForRedisKey(redis, `result:${eventId}`);
    expect(raw).not.toBeNull();

    const result = JSON.parse(raw!);
    expect(result.eventId).toBe(eventId);
    expect(result.processed).toBe(true);

    await redis.del(`result:${eventId}`);
  });
});
