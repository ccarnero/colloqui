import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import { ProvisioningController } from "../../src/modules/provisioning/provisioning.controller";
import { ProvisioningProxyService } from "../../src/modules/provisioning/provisioning-proxy.service";

/**
 * Unit tests for T07 of manual-loops/declarative-provisioning.md — each
 * `ProvisioningController` handler forwards the exact downstream path,
 * tenant, and body to `ProvisioningProxyService`. Full HTTP-level authz/
 * status-mapping contract tests live in `provisioning.controller.http.spec.ts`;
 * the broker-route-absent regression lives in
 * `provisioning.controller.no-internal-route.spec.ts`.
 */
describe("ProvisioningController", () => {
  let controller: ProvisioningController;
  let proxy: ReturnType<typeof mock>;
  let proxyWithStatus: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ ok: true }));
    proxyWithStatus = mock(() =>
      Promise.resolve({ status: 200, body: { ok: true } })
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [ProvisioningController],
      providers: [
        {
          provide: ProvisioningProxyService,
          useValue: { proxy, proxyWithStatus },
        },
      ],
    }).compile();
    controller = moduleRef.get(ProvisioningController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as Record<string, unknown>;
  const fakeReply = () => {
    const status = mock(() => reply);
    const reply = { status } as unknown as Record<string, unknown>;
    return { reply, status };
  };

  it("validate delegates to proxy with the manifests/validate path and body verbatim", async () => {
    const body = { spec: {} };
    await controller.validate(req as never, body);
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: "/manifests/validate",
      tenantId: "t1",
      body,
    });
  });

  it("putManifest delegates to proxy with the encoded name and tenant", async () => {
    const body = { spec: { channels: [] } };
    await controller.putManifest(req as never, "my manifest", body);
    expect(proxy).toHaveBeenCalledWith({
      method: "PUT",
      path: "/manifests/my%20manifest",
      tenantId: "t1",
      body,
    });
  });

  it("getManifest delegates to proxy with the encoded name, no body", async () => {
    await controller.getManifest(req as never, "acme-support");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/manifests/acme-support",
      tenantId: "t1",
    });
  });

  it("plan delegates to proxyWithStatus and forwards the downstream status", async () => {
    const { reply, status } = fakeReply();
    const result = await controller.plan(
      req as never,
      reply as never,
      "acme-support"
    );
    expect(proxyWithStatus).toHaveBeenCalledWith({
      method: "POST",
      path: "/manifests/acme-support/plan",
      tenantId: "t1",
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(result).toEqual({ ok: true });
  });

  it("plan forwards a non-200 downstream status verbatim (e.g. 409 cycle_detected)", async () => {
    proxyWithStatus.mockImplementationOnce(() =>
      Promise.resolve({
        status: 409,
        body: { error: { kind: "cycle_detected" } },
      })
    );
    const { reply, status } = fakeReply();
    const result = await controller.plan(
      req as never,
      reply as never,
      "acme-support"
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(result).toEqual({ error: { kind: "cycle_detected" } });
  });

  it("apply delegates to proxyWithStatus with tenant, encoded name, and bundle body", async () => {
    const body = { bundle: { contentBase64: "abc123" } };
    const { reply, status } = fakeReply();
    const result = await controller.apply(
      req as never,
      reply as never,
      "acme-support",
      body
    );
    expect(proxyWithStatus).toHaveBeenCalledWith({
      method: "POST",
      path: "/manifests/acme-support/apply",
      tenantId: "t1",
      body,
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(result).toEqual({ ok: true });
  });

  it("apply forwards a non-200 downstream status verbatim (e.g. 404 manifest_not_found)", async () => {
    proxyWithStatus.mockImplementationOnce(() =>
      Promise.resolve({
        status: 404,
        body: { message: "No manifest named 'x' found" },
      })
    );
    const { reply, status } = fakeReply();
    await controller.apply(req as never, reply as never, "x", {});
    expect(status).toHaveBeenCalledWith(404);
  });

  it("undeploy delegates to proxyWithStatus with the encoded name and tenant, no body", async () => {
    const { reply, status } = fakeReply();
    const result = await controller.undeploy(
      req as never,
      reply as never,
      "my manifest"
    );
    expect(proxyWithStatus).toHaveBeenCalledWith({
      method: "POST",
      path: "/manifests/my%20manifest/undeploy",
      tenantId: "t1",
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(result).toEqual({ ok: true });
  });

  it("undeploy forwards the 409 undeploy_blocked typed body verbatim (dependents list intact)", async () => {
    const blocked = {
      error: {
        kind: "undeploy_blocked",
        manifestName: "acme-support",
        dependents: [
          {
            manifestName: "other-manifest",
            resourceKind: "channel",
            resourceName: "shared-http-in",
          },
        ],
        message: "manifest 'acme-support' cannot be undeployed",
      },
    };
    proxyWithStatus.mockImplementationOnce(() =>
      Promise.resolve({ status: 409, body: blocked })
    );
    const { reply, status } = fakeReply();
    const result = await controller.undeploy(
      req as never,
      reply as never,
      "acme-support"
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(result).toEqual(blocked);
  });

  it("undeploy forwards a 404 manifest_not_found status verbatim (already undeployed — the CLI renders it as such)", async () => {
    proxyWithStatus.mockImplementationOnce(() =>
      Promise.resolve({
        status: 404,
        body: { message: "No manifest named 'x' found for this tenant" },
      })
    );
    const { reply, status } = fakeReply();
    await controller.undeploy(req as never, reply as never, "x");
    expect(status).toHaveBeenCalledWith(404);
  });

  it("putSecret delegates to proxy with the encoded name, tenant, and value body verbatim", async () => {
    const body = {
      value: "s3cr3t",
      scope: { kind: "connector", owner: "hubspot" },
    };
    await controller.putSecret(req as never, "hubspot-api-key", body);
    expect(proxy).toHaveBeenCalledWith({
      method: "PUT",
      path: "/secrets/hubspot-api-key",
      tenantId: "t1",
      body,
    });
  });

  it("listSecrets delegates to proxy with tenant, no body", async () => {
    await controller.listSecrets(req as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/secrets",
      tenantId: "t1",
    });
  });
});
