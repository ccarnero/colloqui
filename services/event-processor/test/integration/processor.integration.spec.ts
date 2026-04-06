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
import { waitForRedisKey } from "./redis-wait.helpers";

describe("event-processor integration", () => {
  let app: NestFastifyApplication;
  let redis: Redis;
  let nc: NatsConnection;
  let js: JetStreamClient;

  beforeAll(async () => {
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
  });

  it("should consume a published event and write result to Redis", async () => {
    const eventId = `integ-${Date.now()}`;
    const payload = { id: eventId, type: "created", payload: { test: true } };

    await js.publish(
      "events.created",
      new TextEncoder().encode(JSON.stringify(payload)),
    );

    const raw = await waitForRedisKey(redis, `result:${eventId}`);
    expect(raw).not.toBeNull();

    const result = JSON.parse(raw!);
    expect(result.eventId).toBe(eventId);
    expect(result.type).toBe("created");
    expect(result.processed).toBe(true);
    expect(typeof result.timestamp).toBe("number");

    await redis.del(`result:${eventId}`);
  });

  it("should process unknown event type with truthy payload as processed=true", async () => {
    const eventId = `integ-unknown-${Date.now()}`;
    const payload = { id: eventId, type: "custom", payload: { x: 1 } };

    await js.publish(
      "events.custom",
      new TextEncoder().encode(JSON.stringify(payload)),
    );

    const raw = await waitForRedisKey(redis, `result:${eventId}`);
    expect(raw).not.toBeNull();

    const result = JSON.parse(raw!);
    expect(result.processed).toBe(true);

    await redis.del(`result:${eventId}`);
  });

  it("GET /health should report ok", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
  });
});
