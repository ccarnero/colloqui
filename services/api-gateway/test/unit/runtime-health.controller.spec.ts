import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { RuntimeHealthController } from "../../src/modules/runtime/runtime-health.controller";
import { RuntimeProxyService } from "../../src/modules/runtime/runtime-proxy.service";

describe("RuntimeHealthController (api-gateway)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const createController = async (
    fetchImpl?: typeof globalThis.fetch,
  ) => {
    if (fetchImpl) {
      globalThis.fetch = fetchImpl;
    } else {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              status: "ok",
              nats: "connected",
              redis: "connected",
            }),
            { status: 200 },
          ),
        ),
      ) as typeof fetch;
    }

    const module = await Test.createTestingModule({
      controllers: [RuntimeHealthController],
      providers: [RuntimeProxyService],
    }).compile();

    return module.get(RuntimeHealthController);
  };

  it("should return ok when ai-agent-gateway health is ok", async () => {
    const controller = await createController();
    const result = (await controller.checkHealth()) as {
      status: string;
      nats: string;
      redis: string;
    };
    expect(result.status).toBe("ok");
    expect(result.nats).toBe("connected");
    expect(result.redis).toBe("connected");
  });

  it("should return degraded when ai-agent-gateway reports degraded", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "degraded",
            nats: "disconnected",
            redis: "connected",
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    const controller = await createController(globalThis.fetch);
    const result = (await controller.checkHealth()) as {
      status: string;
      nats: string;
      redis: string;
    };
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe("disconnected");
    expect(result.redis).toBe("connected");
  });

  it("should propagate error when ai-agent-gateway is unreachable", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Service Unavailable", { status: 503 })),
    ) as typeof fetch;

    const controller = await createController(globalThis.fetch);
    expect(controller.checkHealth()).rejects.toThrow();
  });
});
