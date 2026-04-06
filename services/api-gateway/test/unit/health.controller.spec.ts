import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { GatewayHealthService } from "../../src/modules/health/gateway-health.service";
import { NATS_CONNECTION } from "../../src/providers/nats.provider";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";

const serviceOkBody = JSON.stringify({ status: "ok" });
const serviceDegradedBody = JSON.stringify({
  status: "degraded",
  redis: "disconnected",
});

describe("HealthController (api-gateway)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const createController = async (
    natsOk: boolean,
    redisOk: boolean,
    fetchImpl?: typeof globalThis.fetch,
  ) => {
    if (fetchImpl) {
      globalThis.fetch = fetchImpl;
    } else {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(serviceOkBody, { status: 200 })),
      ) as typeof fetch;
    }

    const mockNats = { isClosed: mock(() => !natsOk) };
    const mockRedis = {
      ping: redisOk
        ? mock(() => Promise.resolve("PONG"))
        : mock(() => Promise.reject(new Error("connection refused"))),
    };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        GatewayHealthService,
        { provide: NATS_CONNECTION, useValue: mockNats },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    return module.get(HealthController);
  };

  it("should return ok when NATS, Redis, and all services are healthy", async () => {
    const controller = await createController(true, true);
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.nats).toBe("connected");
    expect(result.redis).toBe("connected");
    expect(result.services["cache-service"]).toEqual({ status: "ok" });
    expect(result.services["webhook-service"]).toEqual({ status: "ok" });
    expect(result.services["audit-service"]).toEqual({ status: "ok" });
    expect(result.services["event-processor"]).toEqual({ status: "ok" });
    expect(result.services["metrics-service"]).toEqual({ status: "ok" });
    expect(result.services["scheduler-service"]).toEqual({ status: "ok" });
  });

  it("should return degraded when NATS is disconnected", async () => {
    const controller = await createController(false, true);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe("disconnected");
    expect(result.redis).toBe("connected");
  });

  it("should return degraded when Redis ping fails", async () => {
    const controller = await createController(true, false);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe("connected");
    expect(result.redis).toBe("disconnected");
  });

  it("should return degraded when both NATS and Redis are down", async () => {
    const controller = await createController(false, false);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe("disconnected");
    expect(result.redis).toBe("disconnected");
  });

  it("should mark a service as unreachable when fetch fails", async () => {
    const fetchMock = mock((url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("cache-service")) {
        return Promise.reject(new Error("ECONNREFUSED"));
      }
      return Promise.resolve(new Response(serviceOkBody, { status: 200 }));
    }) as typeof fetch;

    const controller = await createController(true, true, fetchMock);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.services["cache-service"]).toBe("unreachable");
    expect(result.services["webhook-service"]).toEqual({ status: "ok" });
  });

  it("should mark a service as unreachable when it returns non-ok status", async () => {
    const fetchMock = mock((url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("webhook-service")) {
        return Promise.resolve(new Response("", { status: 503 }));
      }
      return Promise.resolve(new Response(serviceOkBody, { status: 200 }));
    }) as typeof fetch;

    const controller = await createController(true, true, fetchMock);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.services["webhook-service"]).toBe("unreachable");
  });

  it("should propagate degraded status from a downstream service", async () => {
    const fetchMock = mock((url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("event-processor")) {
        return Promise.resolve(
          new Response(serviceDegradedBody, { status: 200 }),
        );
      }
      return Promise.resolve(new Response(serviceOkBody, { status: 200 }));
    }) as typeof fetch;

    const controller = await createController(true, true, fetchMock);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.services["event-processor"]).toEqual({
      status: "degraded",
      redis: "disconnected",
    });
  });
});
