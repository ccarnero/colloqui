import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import { ConnectorInvokeController } from "../../src/modules/connector-invoke/connector-invoke.controller";
import { ConnectorInvokeProxyService } from "../../src/modules/connector-invoke/connector-invoke-proxy.service";

/**
 * Unit tests for T03 of manual-loops/connector-invoke-api.md — the
 * `ConnectorInvokeController.invoke` handler forwards the exact
 * connectorId/endpointId/tenant/body to `ConnectorInvokeProxyService`.
 * Full HTTP-level authz/status-mapping contract tests live in
 * `connector-invoke.controller.http.spec.ts`.
 */
describe("ConnectorInvokeController", () => {
  let controller: ConnectorInvokeController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ invocationId: "inv-1", status: 200 }));
    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectorInvokeController],
      providers: [
        { provide: ConnectorInvokeProxyService, useValue: { proxy } },
      ],
    }).compile();
    controller = moduleRef.get(ConnectorInvokeController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as Record<string, unknown>;

  it("invoke delegates to proxy with tenant, encoded ids and body verbatim", async () => {
    const body = { args: { foo: "bar" }, mode: "sync" };
    await controller.invoke(req as never, "conn/1", "ep 1", body);
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: "/invoke/conn%2F1/ep%201",
      tenantId: "t1",
      body,
    });
  });
});
