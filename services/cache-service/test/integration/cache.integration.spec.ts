import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ValidationPipe } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import Redis from "ioredis";

/**
 * Live-Redis coverage for the whole HTTP surface (CRUD, TTL expiry, batch,
 * SCAN, health). It bootstraps the real AppModule, so it needs a reachable
 * Redis: set TEST_REDIS_URL to run it, otherwise the suite is skipped — the
 * same env-gate convention agent-admin-service uses for its live-Postgres
 * suite (test/integration/postgres-fragment-bugs.integration.spec.ts:42-44).
 *
 * Against the dev cluster's Redis:
 *
 *   kubectl port-forward -n support-services-dev svc/redis 16379:6379
 *   TEST_REDIS_URL=redis://localhost:16379 bun test test/integration
 *
 * REDIS_HOST/REDIS_PORT are derived from TEST_REDIS_URL BEFORE the app module
 * is loaded because the shared `redisProvider` reads them in its factory
 * (packages/database/src/redis-provider.ts) — hence the dynamic import of
 * AppModule inside beforeAll rather than a hoisted top-level import.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
if (TEST_REDIS_URL) {
  const parsed = new URL(TEST_REDIS_URL);
  process.env.REDIS_HOST = parsed.hostname;
  process.env.REDIS_PORT = parsed.port || "6379";
  process.env.REDIS_CLUSTER_MODE = "false";
}

/**
 * Run-unique key prefix: the dev cluster's Redis is shared with every other
 * service, so a fixed "integ:" prefix would risk clobbering (and being
 * clobbered by) a concurrent run of this same suite.
 */
const PREFIX = `integ:${process.pid}-${Date.now()}`;

describe.skipIf(!TEST_REDIS_URL)("cache-service integration", () => {
  let app: NestFastifyApplication;
  let redis: Redis;

  beforeAll(async () => {
    const { AppModule } = await import("../../src/app.module");
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      })
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    redis = new Redis(TEST_REDIS_URL as string);
  });

  afterAll(async () => {
    if (redis) {
      const keys = await redis.keys(`${PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      await redis.quit();
    }
    if (app) {
      await app.close();
    }
  });

  it("should perform full CRUD cycle via HTTP", async () => {
    const key = `${PREFIX}:crud`;
    const putRes = await app.inject({
      method: "PUT",
      url: `/cache/${key}`,
      payload: { value: { hello: "world" }, ttl: 60 },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toEqual({ ok: true });

    const getRes = await app.inject({
      method: "GET",
      url: `/cache/${key}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual({ hello: "world" });

    const delRes = await app.inject({
      method: "DELETE",
      url: `/cache/${key}`,
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ ok: true });

    const getAfterDel = await app.inject({
      method: "GET",
      url: `/cache/${key}`,
    });
    expect(getAfterDel.statusCode).toBe(200);
    // A miss is HTTP 200 with a JSON `null` body — NOT an empty body. The
    // assertion this replaces expected `""`, which no live run ever executed.
    expect(getAfterDel.headers["content-type"]).toContain("application/json");
    expect(getAfterDel.json()).toBeNull();
  });

  /**
   * Regression: a cached STRING used to be handed to Fastify as a plain string
   * payload, which it sends verbatim as `text/plain` — so `GET` returned
   * `hello` (unquoted, unparseable) while objects/numbers/null returned JSON.
   * Every value type must round-trip through `response.json()`.
   */
  it("should return JSON for every value type, including strings", async () => {
    const cases: Array<[string, unknown]> = [
      ["string", "hello"],
      ["object", { a: 1, nested: { b: [1, 2] } }],
      ["number", 42],
      ["boolean", true],
      ["array", [1, "two", null]],
    ];
    for (const [label, value] of cases) {
      const key = `${PREFIX}:json-${label}`;
      const putRes = await app.inject({
        method: "PUT",
        url: `/cache/${key}`,
        payload: { value },
      });
      expect(putRes.statusCode).toBe(200);

      const getRes = await app.inject({ method: "GET", url: `/cache/${key}` });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.headers["content-type"]).toContain("application/json");
      expect(getRes.json()).toEqual(value);
    }
  });

  it("should honor TTL expiry on the write path", async () => {
    const key = `${PREFIX}:ttl-write`;
    const putRes = await app.inject({
      method: "PUT",
      url: `/cache/${key}`,
      payload: { value: "expires", ttl: 1 },
    });
    expect(putRes.statusCode).toBe(200);

    expect(await redis.ttl(key)).toBeGreaterThan(0);

    await Bun.sleep(1500);

    const getRes = await app.inject({ method: "GET", url: `/cache/${key}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toBeNull();
  });

  /**
   * Regression: a Redis hit used to backfill L1 with `expiry: 0` ("never
   * expires"), so any key whose TTL was written by ANOTHER writer — a second
   * replica (max-scale 5) or a direct Redis writer — stayed readable from this
   * instance's L1 forever after Redis had already expired it. Writing the key
   * straight through `redis` here is what reproduces it: the HTTP GET is the
   * first time this instance sees the key, so it takes the Redis-hit backfill
   * path.
   */
  it("should expire an L1 entry backfilled from a Redis key written elsewhere", async () => {
    const key = `${PREFIX}:ttl-backfill`;
    await redis.set(key, JSON.stringify("from-another-writer"), "EX", 1);

    const firstGet = await app.inject({ method: "GET", url: `/cache/${key}` });
    expect(firstGet.statusCode).toBe(200);
    expect(firstGet.json()).toBe("from-another-writer");

    await Bun.sleep(1500);

    expect(await redis.exists(key)).toBe(0);

    const secondGet = await app.inject({ method: "GET", url: `/cache/${key}` });
    expect(secondGet.statusCode).toBe(200);
    expect(secondGet.json()).toBeNull();
  });

  it("should batch get multiple keys", async () => {
    const keys = [`${PREFIX}:b1`, `${PREFIX}:b2`, `${PREFIX}:b3`];
    for (const k of keys) {
      await app.inject({
        method: "PUT",
        url: `/cache/${k}`,
        payload: { value: k },
      });
    }

    const batchRes = await app.inject({
      method: "POST",
      url: "/cache/batch",
      payload: { keys },
    });

    expect(batchRes.statusCode).toBe(200);
    const body = batchRes.json();
    for (const k of keys) {
      expect(body[k]).toBe(k);
    }
  });

  it("should omit missing keys from a batch get", async () => {
    const present = `${PREFIX}:b-present`;
    const missing = `${PREFIX}:b-missing`;
    await app.inject({
      method: "PUT",
      url: `/cache/${present}`,
      payload: { value: "here" },
    });

    const batchRes = await app.inject({
      method: "POST",
      url: "/cache/batch",
      payload: { keys: [present, missing] },
    });

    expect(batchRes.statusCode).toBe(200);
    const body = batchRes.json();
    expect(body[present]).toBe("here");
    expect(Object.keys(body)).not.toContain(missing);
  });

  it("should scan keys by pattern", async () => {
    await app.inject({
      method: "PUT",
      url: `/cache/${PREFIX}:scan1`,
      payload: { value: "a" },
    });
    await app.inject({
      method: "PUT",
      url: `/cache/${PREFIX}:scan2`,
      payload: { value: "b" },
    });

    const scanRes = await app.inject({
      method: "GET",
      url: `/cache?pattern=${PREFIX}:scan*`,
    });

    expect(scanRes.statusCode).toBe(200);
    const keys = scanRes.json() as string[];
    expect(keys).toContain(`${PREFIX}:scan1`);
    expect(keys).toContain(`${PREFIX}:scan2`);
  });

  it("should scope keys by the tenant header", async () => {
    const key = `${PREFIX}:tenant-scoped`;
    const putRes = await app.inject({
      method: "PUT",
      url: `/cache/${key}`,
      headers: { "x-yoizen-tenant": "acme" },
      payload: { value: "tenant-value" },
    });
    expect(putRes.statusCode).toBe(200);

    expect(await redis.get(`acme:${key}`)).toBe(JSON.stringify("tenant-value"));

    const untenanted = await app.inject({
      method: "GET",
      url: `/cache/${key}`,
    });
    expect(untenanted.json()).toBeNull();

    const tenanted = await app.inject({
      method: "GET",
      url: `/cache/${key}`,
      headers: { "x-yoizen-tenant": "acme" },
    });
    expect(tenanted.json()).toBe("tenant-value");

    await redis.del(`acme:${key}`);
  });

  it("GET /health should report ok", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.redis).toBe("connected");
  });
});
