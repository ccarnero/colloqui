import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdminProxyService } from "../../src/modules/admin/admin-proxy.service";
import { AdminStructuredKBController } from "../../src/modules/admin/admin-structured-kb.controller";

describe("AdminStructuredKBController", () => {
  let controller: AdminStructuredKBController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({}));
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminStructuredKBController],
      providers: [{ provide: AdminProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(AdminStructuredKBController);
  });

  const req = { tenantId: "t1" } as never;

  it("query proxies POST /admin/structured-kb/containers/:id/query", async () => {
    const body = {
      query: "refund policy",
      categories: ["billing"],
      limit: 5,
      offset: 0,
    } as never;
    await controller.query(req, "container-1", body);
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: "/admin/structured-kb/containers/container-1/query",
      tenantId: "t1",
      body,
    });
  });
});
