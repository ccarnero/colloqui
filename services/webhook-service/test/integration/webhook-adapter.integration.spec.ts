import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import Redis from "ioredis";
import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  RetentionPolicy,
} from "nats";
import {
  RESULTS_STREAM_NAME,
  RESULTS_STREAM_SUBJECTS,
  RESULTS_SUBJECT_PREFIX,
  RESULTS_STREAM_MAX_BYTES,
  STREAM_MAX_AGE_NS,
} from "@yoizen/shared";
import type { CompletionEvent, ProcessedEvent } from "@yoizen/shared";
import type { Server } from "bun";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ADAPTER_PORT = 19998;
const CALLBACK_PORT = 19997;

const fakeAdapterConfig = {
  id: "adp-wh-integ",
  tenantId: "t1",
  name: "Webhook Integration Adapter",
  context: "test",
  baseUrl: `http://localhost:${CALLBACK_PORT}`,
  authType: "bearer",
  authConfig: { bearerToken: "wh-integ-token" },
  headers: [{ key: "X-Webhook-Custom", value: "true" }],
  timeoutMs: 5000,
  maxRetries: 2,
  retryBackoffMs: 50,
  healthCheckPath: "/health",
  status: "active",
  endpoints: [],
};

interface CallbackHit {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

describe("webhook-service adapter integration", () => {
  let app: NestFastifyApplication;
  let redis: Redis;
  let nc: NatsConnection;
  let js: JetStreamClient;
  let adapterServer: Server;
  let callbackServer: Server;
  let callbackHits: CallbackHit[];

  beforeAll(async () => {
    process.env.ADAPTER_SERVICE_URL = `http://localhost:${ADAPTER_PORT}`;

    callbackHits = [];

    adapterServer = Bun.serve({
      port: ADAPTER_PORT,
      fetch(req) {
        if (req.url.includes("/adapters/adp-wh-integ")) {
          return new Response(JSON.stringify(fakeAdapterConfig), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    callbackServer = Bun.serve({
      port: CALLBACK_PORT,
      async fetch(req) {
        const headers: Record<string, string> = {};
        req.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const body = await req.json().catch(() => null);
        callbackHits.push({
          method: req.method,
          url: req.url,
          headers,
          body,
        });
        return new Response("OK", { status: 200 });
      },
    });

    redis = new Redis({ host: "localhost", port: 6379 });
    nc = await connect({ servers: "nats://localhost:4222" });

    const jsm = await nc.jetstreamManager();
    try {
      await jsm.streams.info(RESULTS_STREAM_NAME);
    } catch {
      await jsm.streams.add({
        name: RESULTS_STREAM_NAME,
        subjects: [...RESULTS_STREAM_SUBJECTS],
        retention: RetentionPolicy.Limits,
        max_age: STREAM_MAX_AGE_NS,
        max_bytes: RESULTS_STREAM_MAX_BYTES,
      });
    }

    js = nc.jetstream();

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    await sleep(1_000);
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await nc.close();
    adapterServer.stop(true);
    callbackServer.stop(true);
  });

  it("should deliver webhook with adapter auth headers when adapter_id is present", async () => {
    callbackHits.length = 0;
    const eventId = `wh-integ-adapter-${Date.now()}`;

    const result: ProcessedEvent = {
      eventId,
      type: "created",
      processed: true,
      timestamp: Date.now(),
      tenant: "t1",
    };

    const completion: CompletionEvent = {
      eventId,
      type: "created",
      result,
      callback_url: `http://localhost:${CALLBACK_PORT}/hook`,
      adapter_id: "adp-wh-integ",
    };

    await js.publish(
      `${RESULTS_SUBJECT_PREFIX}.created`,
      new TextEncoder().encode(JSON.stringify(completion)),
    );

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && callbackHits.length === 0) {
      await sleep(250);
    }

    expect(callbackHits.length).toBeGreaterThanOrEqual(1);
    const hit = callbackHits[0];
    expect(hit.headers["authorization"]).toBe("Bearer wh-integ-token");
    expect(hit.headers["x-webhook-custom"]).toBe("true");
  });

  it("should deliver webhook with default headers when no adapter_id", async () => {
    callbackHits.length = 0;
    const eventId = `wh-integ-default-${Date.now()}`;

    const result: ProcessedEvent = {
      eventId,
      type: "created",
      processed: true,
      timestamp: Date.now(),
    };

    const completion: CompletionEvent = {
      eventId,
      type: "created",
      result,
      callback_url: `http://localhost:${CALLBACK_PORT}/hook`,
    };

    await js.publish(
      `${RESULTS_SUBJECT_PREFIX}.created`,
      new TextEncoder().encode(JSON.stringify(completion)),
    );

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && callbackHits.length === 0) {
      await sleep(250);
    }

    expect(callbackHits.length).toBeGreaterThanOrEqual(1);
    const hit = callbackHits[0];
    expect(hit.headers["authorization"]).toBeUndefined();
    expect(hit.headers["content-type"]).toBe("application/json");
  });

  it("should deliver webhook with defaults when adapter-service returns 500", async () => {
    adapterServer.stop(true);

    adapterServer = Bun.serve({
      port: ADAPTER_PORT,
      fetch() {
        return new Response("Internal Server Error", { status: 500 });
      },
    });

    await redis.del("adapter:config:t1:adp-wh-integ");

    callbackHits.length = 0;
    const eventId = `wh-integ-fail-${Date.now()}`;

    const result: ProcessedEvent = {
      eventId,
      type: "created",
      processed: true,
      timestamp: Date.now(),
      tenant: "t1",
    };

    const completion: CompletionEvent = {
      eventId,
      type: "created",
      result,
      callback_url: `http://localhost:${CALLBACK_PORT}/hook`,
      adapter_id: "adp-wh-integ",
    };

    await js.publish(
      `${RESULTS_SUBJECT_PREFIX}.created`,
      new TextEncoder().encode(JSON.stringify(completion)),
    );

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && callbackHits.length === 0) {
      await sleep(250);
    }

    expect(callbackHits.length).toBeGreaterThanOrEqual(1);
    const hit = callbackHits[0];
    expect(hit.headers["authorization"]).toBeUndefined();

    adapterServer.stop(true);
    adapterServer = Bun.serve({
      port: ADAPTER_PORT,
      fetch(req) {
        if (req.url.includes("/adapters/adp-wh-integ")) {
          return new Response(JSON.stringify(fakeAdapterConfig), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
  });
});
