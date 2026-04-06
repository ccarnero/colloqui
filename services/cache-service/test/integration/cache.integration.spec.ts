import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import Redis from "ioredis";

describe("cache-service integration", () => {
  let app: NestFastifyApplication;
  let redis: Redis;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    redis = new Redis({ host: "localhost", port: 6379 });
  });

  afterAll(async () => {
    const keys = await redis.keys("integ:*");
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
    await app.close();
  });

  it("should perform full CRUD cycle via HTTP", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: "/cache/integ:crud",
      payload: { value: { hello: "world" }, ttl: 60 },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toEqual({ ok: true });

    const getRes = await app.inject({
      method: "GET",
      url: "/cache/integ:crud",
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual({ hello: "world" });

    const delRes = await app.inject({
      method: "DELETE",
      url: "/cache/integ:crud",
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ ok: true });

    const getAfterDel = await app.inject({
      method: "GET",
      url: "/cache/integ:crud",
    });
    expect(getAfterDel.statusCode).toBe(200);
    expect(getAfterDel.body).toBe("");
  });

  it("should batch get multiple keys", async () => {
    for (const k of ["integ:b1", "integ:b2", "integ:b3"]) {
      await app.inject({
        method: "PUT",
        url: `/cache/${k}`,
        payload: { value: k },
      });
    }

    const batchRes = await app.inject({
      method: "POST",
      url: "/cache/batch",
      payload: { keys: ["integ:b1", "integ:b2", "integ:b3"] },
    });

    expect(batchRes.statusCode).toBe(200);
    const body = batchRes.json();
    expect(body["integ:b1"]).toBe("integ:b1");
    expect(body["integ:b2"]).toBe("integ:b2");
    expect(body["integ:b3"]).toBe("integ:b3");
  });

  it("should scan keys by pattern", async () => {
    await app.inject({
      method: "PUT",
      url: "/cache/integ:scan1",
      payload: { value: "a" },
    });
    await app.inject({
      method: "PUT",
      url: "/cache/integ:scan2",
      payload: { value: "b" },
    });

    const scanRes = await app.inject({
      method: "GET",
      url: "/cache?pattern=integ:scan*",
    });

    expect(scanRes.statusCode).toBe(200);
    const keys = scanRes.json() as string[];
    expect(keys).toContain("integ:scan1");
    expect(keys).toContain("integ:scan2");
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
