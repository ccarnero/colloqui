import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConnectorsController } from "../../src/modules/connectors/connectors.controller";
import { ConnectorsProxyService } from "../../src/modules/connectors/connectors-proxy.service";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";

describe("ConnectorsController", () => {
  let controller: ConnectorsController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ items: [] }));
    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectorsController],
      providers: [{ provide: ConnectorsProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(ConnectorsController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as Record<string, unknown>;

  it("list delegates to proxy with tenant and query", async () => {
    await controller.list(req as never, "ctx-a", undefined);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/connectors",
      tenantId: "t1",
      query: { context: "ctx-a", tag: undefined },
    });
  });

  it("get delegates with encoded id", async () => {
    await controller.get(req as never, "id/1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/connectors/id%2F1",
      tenantId: "t1",
    });
  });

  it("usage delegates before id routes", async () => {
    await controller.usage(req as never, "7");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/connectors/usage",
      tenantId: "t1",
      query: { window: "7" },
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
      path: "/connectors",
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
      path: "/connectors/adp%2F1/endpoints/ep%2F1",
      tenantId: "t1",
      body,
    });
  });
});
