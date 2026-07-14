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
  let proxyWithStatus: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ invocationId: "inv-1", status: 200 }));
    proxyWithStatus = mock(() =>
      Promise.resolve({ status: 200, body: { invocationId: "inv-1" } })
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectorInvokeController],
      providers: [
        {
          provide: ConnectorInvokeProxyService,
          useValue: { proxy, proxyWithStatus },
        },
      ],
    }).compile();
    controller = moduleRef.get(ConnectorInvokeController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as Record<string, unknown>;
  const fakeReply = () => {
    const status = mock(() => reply);
    const reply = { status } as unknown as Record<string, unknown>;
    return { reply, status };
  };

  it("invoke delegates to proxyWithStatus with tenant, encoded ids and body verbatim", async () => {
    const body = { args: { foo: "bar" }, mode: "sync" };
    const { reply } = fakeReply();
    await controller.invoke(
      req as never,
      reply as never,
      "conn/1",
      "ep 1",
      body
    );
    expect(proxyWithStatus).toHaveBeenCalledWith({
      method: "POST",
      path: "/invoke/conn%2F1/ep%201",
      tenantId: "t1",
      body,
    });
  });

  it("invoke sets the reply status from proxyWithStatus's downstream status (T06 202 fix)", async () => {
    proxyWithStatus.mockImplementationOnce(() =>
      Promise.resolve({ status: 202, body: { invocationId: "inv-async" } })
    );
    const { reply, status } = fakeReply();
    const result = await controller.invoke(
      req as never,
      reply as never,
      "conn-1",
      "ep-1",
      { args: {}, mode: "async" }
    );
    expect(status).toHaveBeenCalledWith(202);
    expect(result).toEqual({ invocationId: "inv-async" });
  });

  // --- T05: GET /connectors/invocations/:invocationId ---

  it("getInvocation delegates to proxy with tenant and encoded invocationId, no body", async () => {
    await controller.getInvocation(req as never, "inv 1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/invocations/inv%201",
      tenantId: "t1",
    });
  });
});
