import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdaptersController } from "../../src/modules/adapters/adapters.controller";
import { AdaptersProxyService } from "../../src/modules/adapters/adapters-proxy.service";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";

describe("AdaptersController", () => {
  let controller: AdaptersController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ items: [] }));
    const moduleRef = await Test.createTestingModule({
      controllers: [AdaptersController],
      providers: [{ provide: AdaptersProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(AdaptersController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as Record<string, unknown>;

  it("list delegates to proxy with tenant and query", async () => {
    await controller.list(req as never, "ctx-a");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/adapters",
      tenantId: "t1",
      query: { context: "ctx-a" },
    });
  });

  it("get delegates with encoded id", async () => {
    await controller.get(req as never, "id/1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/adapters/id%2F1",
      tenantId: "t1",
    });
  });

  it("create forwards nested cache config unchanged", async () => {
    const body = {
      name: "json",
      context: "external",
      baseUrl: "https://jsonplaceholder.typicode.com",
      endpoints: [
        {
          label: "todo",
          method: "GET",
          path: "/todos/1",
          cache: {
            enabled: true,
            ttlSeconds: 60,
            methods: ["GET", "HEAD"],
            keyBody: false,
            keyHeaders: [],
            keyQueryParams: "all",
          },
        },
      ],
      defaultCache: {
        enabled: true,
        ttlSeconds: 30,
        methods: ["GET"],
      },
    };

    await controller.create(req as never, body as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: "/adapters",
      tenantId: "t1",
      body,
    });
  });

  it("updateEndpoint proxies the endpoint patch route", async () => {
    const body = {
      cache: {
        enabled: true,
        ttlSeconds: 45,
        methods: ["POST"],
        keyBody: true,
      },
    };

    await controller.updateEndpoint(req as never, "adp/1", "ep/1", body as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/adapters/adp%2F1/endpoints/ep%2F1",
      tenantId: "t1",
      body,
    });
  });
});
