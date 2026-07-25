import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { PERMISSIONS_KEY } from "../../src/decorators/permissions.decorator";
import { SCOPES_KEY } from "../../src/decorators/scopes.decorator";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import { TrackingController } from "../../src/modules/tracking/tracking.controller";
import { TrackingProxyService } from "../../src/modules/tracking/tracking-proxy.service";

describe("TrackingController", () => {
  let controller: TrackingController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() =>
      Promise.resolve({ correlationId: "corr-1", events: [] })
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [TrackingController],
      providers: [{ provide: TrackingProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(TrackingController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as Record<string, unknown>;

  it("getChain delegates to proxy with tenant, path and encoded correlationId", async () => {
    const result = await controller.getChain(req as never, "corr-1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/chains/corr-1",
      tenantId: "t1",
    });
    expect(result).toEqual({ correlationId: "corr-1", events: [] });
  });

  it("getChain encodes special characters in the correlationId", async () => {
    await controller.getChain(req as never, "corr/1 x");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/chains/corr%2F1%20x",
      tenantId: "t1",
    });
  });

  it("getPayload delegates to proxy with tenant, path and encoded ids", async () => {
    const result = await controller.getPayload(req as never, "corr-1", "evt-1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/chains/corr-1/events/evt-1/payload",
      tenantId: "t1",
    });
    expect(result).toEqual({ correlationId: "corr-1", events: [] });
  });

  it("getPayload encodes special characters in both ids", async () => {
    await controller.getPayload(req as never, "corr/1 x", "evt/1 x");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/chains/corr%2F1%20x/events/evt%2F1%20x/payload",
      tenantId: "t1",
    });
  });

  it("getPayload stamps req.__correlationId so the global AuditInterceptor picks it up", async () => {
    const stampedReq = {
      [REQUEST_TENANT_KEY]: "t1",
    } as Record<string, unknown>;
    await controller.getPayload(stampedReq as never, "corr-1", "evt-1");
    expect(stampedReq.__correlationId).toBe("corr-1");
  });

  it("getPayload is guarded by @Scopes(platform, tenant) + @RequirePermission(tracking:payload:read) — the same admin-guard mechanism as AuthController's tenant-roles routes", () => {
    const scopes = Reflect.getMetadata(
      SCOPES_KEY,
      TrackingController.prototype.getPayload
    );
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TrackingController.prototype.getPayload
    );
    expect(scopes).toEqual(["platform", "tenant"]);
    expect(permissions).toEqual(["tracking:payload:read"]);
  });

  it("getChain carries no permission guard (unchanged from before T04)", () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TrackingController.prototype.getChain
    );
    expect(permissions).toBeUndefined();
  });

  it("getRun delegates to proxy with tenant, path and both ids", async () => {
    const runReq = { ...req, url: "/api/tracking/runs/wf-1/run-1" };
    const result = await controller.getRun(runReq as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/runs/wf-1/run-1",
      tenantId: "t1",
    });
    expect(result).toEqual({ correlationId: "corr-1", events: [] });
  });

  it("getRun decodes a percent-encoded colon-bearing workflowId (composite id shape acme:name:sha256:...:id) from the wildcard path and re-encodes it for the proxy", async () => {
    const runReq = {
      ...req,
      url: "/api/tracking/runs/acme%3Ae2e-http-log%3Asha256%3Adeadbeef%3Aid/run-1",
    };
    await controller.getRun(runReq as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/runs/acme%3Ae2e-http-log%3Asha256%3Adeadbeef%3Aid/run-1",
      tenantId: "t1",
    });
  });

  it("getRun decodes and re-encodes special characters in both ids", async () => {
    const runReq = {
      ...req,
      url: "/api/tracking/runs/wf%2F1%20x/run%2F1%20x",
    };
    await controller.getRun(runReq as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/runs/wf%2F1%20x/run%2F1%20x",
      tenantId: "t1",
    });
  });

  it("getRun throws NotFoundException when the wildcard path does not resolve to exactly two segments", async () => {
    const runReq = { ...req, url: "/api/tracking/runs/only-one-segment" };
    await expect(controller.getRun(runReq as never)).rejects.toThrow(
      "Invalid run path"
    );
  });

  it("getRun carries no permission guard (unauthenticated-scope, unlike getPayload)", () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TrackingController.prototype.getRun
    );
    const scopes = Reflect.getMetadata(
      SCOPES_KEY,
      TrackingController.prototype.getRun
    );
    expect(permissions).toBeUndefined();
    expect(scopes).toBeUndefined();
  });

  it("getEvents delegates to proxy with tenant, path and the raw query object", async () => {
    const result = await controller.getEvents(req as never, {
      type: "connector.endpoint_call.completed.v1",
      resource: "adapter/adp-1",
      from: "2026-07-01T00:00:00.000Z",
      limit: "10",
    });
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/events",
      tenantId: "t1",
      query: {
        type: "connector.endpoint_call.completed.v1",
        resource: "adapter/adp-1",
        from: "2026-07-01T00:00:00.000Z",
        limit: "10",
      },
    });
    expect(result).toEqual({ correlationId: "corr-1", events: [] });
  });

  it("getEvents forwards an empty query object as-is (validation lives in the ingester)", async () => {
    await controller.getEvents(req as never, {});
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/events",
      tenantId: "t1",
      query: {},
    });
  });

  it("getEvents carries no permission guard (unauthenticated-scope, same as getChain/getRun)", () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TrackingController.prototype.getEvents
    );
    const scopes = Reflect.getMetadata(
      SCOPES_KEY,
      TrackingController.prototype.getEvents
    );
    expect(permissions).toBeUndefined();
    expect(scopes).toBeUndefined();
  });

  // T07 of manual-loops/admin-console/console-redesign-builder-v2.md.
  it("getNodeStats delegates to proxy with tenant, path and the raw query object", async () => {
    const result = await controller.getNodeStats(req as never, {
      correlationIds: "corr-1,corr-2",
    });
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/node-stats",
      tenantId: "t1",
      query: { correlationIds: "corr-1,corr-2" },
    });
    expect(result).toEqual({ correlationId: "corr-1", events: [] });
  });

  it("getNodeStats carries no permission guard (unauthenticated-scope, same as getEvents)", () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TrackingController.prototype.getNodeStats
    );
    const scopes = Reflect.getMetadata(
      SCOPES_KEY,
      TrackingController.prototype.getNodeStats
    );
    expect(permissions).toBeUndefined();
    expect(scopes).toBeUndefined();
  });
});
