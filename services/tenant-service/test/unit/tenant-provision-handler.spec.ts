import "../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { ProvisioningStatus } from "@yoizen/shared";
import { PermanentError } from "@yoizen/shared";
import { TenantProvisionHandler } from "../../src/modules/provisioning/tenant-provision-handler.service";
import { TenantProvisioningExecutor } from "../../src/modules/provisioning/tenant-provisioning-executor.service";
import { TenantsRepository } from "../../src/modules/tenants/tenants.repository";

function makeMsg(
  data: string,
  deliveryCount: number,
): {
  data: Uint8Array;
  info: { deliveryCount: number };
} {
  return {
    data: new TextEncoder().encode(data),
    info: { deliveryCount },
  };
}

const validPayload = JSON.stringify({
  schemaVersion: 1,
  tenantId: "tid-1",
  name: "acme",
  configuration: {},
});

describe("TenantProvisionHandler", () => {
  it("acks when tenant already ready", async () => {
    const repository = {
      findById: mock(() =>
        Promise.resolve({
          id: "tid-1",
          name: "acme",
          provisioning_status: ProvisioningStatus.Ready,
        }),
      ),
    };
    const executor = { run: mock(() => Promise.resolve({ nsName: "n", namespacePhase: "Active" })) };
    const handler = new TenantProvisionHandler(
      repository as unknown as TenantsRepository,
      executor as unknown as TenantProvisioningExecutor,
    );
    await handler.handle(
      makeMsg(validPayload, 1) as Parameters<TenantProvisionHandler["handle"]>[0],
    );
    expect(executor.run).not.toHaveBeenCalled();
  });

  it("runs executor and marks ready on success", async () => {
    const repository = {
      findById: mock(() =>
        Promise.resolve({
          id: "tid-1",
          name: "acme",
          provisioning_status: ProvisioningStatus.Pending,
        }),
      ),
      markProvisioningStarted: mock(() => Promise.resolve()),
      markProvisioningReady: mock(() => Promise.resolve()),
    };
    const executor = {
      run: mock(() =>
        Promise.resolve({ nsName: "ns", namespacePhase: "Active" }),
      ),
    };
    const handler = new TenantProvisionHandler(
      repository as unknown as TenantsRepository,
      executor as unknown as TenantProvisioningExecutor,
    );
    await handler.handle(
      makeMsg(validPayload, 1) as Parameters<TenantProvisionHandler["handle"]>[0],
    );
    expect(repository.markProvisioningStarted).toHaveBeenCalled();
    expect(executor.run).toHaveBeenCalled();
    expect(repository.markProvisioningReady).toHaveBeenCalled();
  });

  it("naks on transient error when under max deliver", async () => {
    const repository = {
      findById: mock(() =>
        Promise.resolve({
          id: "tid-1",
          name: "acme",
          provisioning_status: ProvisioningStatus.Pending,
        }),
      ),
      markProvisioningStarted: mock(() => Promise.resolve()),
      markProvisioningReady: mock(() => Promise.resolve()),
      markProvisioningFailed: mock(() => Promise.resolve()),
    };
    const executor = {
      run: mock(() => Promise.reject(new Error("transient"))),
    };
    const handler = new TenantProvisionHandler(
      repository as unknown as TenantsRepository,
      executor as unknown as TenantProvisioningExecutor,
    );
    await expect(
      handler.handle(
        makeMsg(validPayload, 2) as Parameters<TenantProvisionHandler["handle"]>[0],
      ),
    ).rejects.toThrow("transient");
    expect(repository.markProvisioningFailed).not.toHaveBeenCalled();
  });

  it("marks failed and throws PermanentError on last delivery", async () => {
    const repository = {
      findById: mock(() =>
        Promise.resolve({
          id: "tid-1",
          name: "acme",
          provisioning_status: ProvisioningStatus.Pending,
        }),
      ),
      markProvisioningStarted: mock(() => Promise.resolve()),
      markProvisioningReady: mock(() => Promise.resolve()),
      markProvisioningFailed: mock(() => Promise.resolve()),
    };
    const executor = {
      run: mock(() => Promise.reject(new Error("still bad"))),
    };
    const handler = new TenantProvisionHandler(
      repository as unknown as TenantsRepository,
      executor as unknown as TenantProvisioningExecutor,
    );
    await expect(
      handler.handle(
        makeMsg(validPayload, 5) as Parameters<TenantProvisionHandler["handle"]>[0],
      ),
    ).rejects.toBeInstanceOf(PermanentError);
    expect(repository.markProvisioningFailed).toHaveBeenCalled();
  });

  it("throws PermanentError for invalid JSON", async () => {
    const repository = { findById: mock(() => Promise.resolve(undefined)) };
    const executor = { run: mock(() => Promise.resolve()) };
    const handler = new TenantProvisionHandler(
      repository as unknown as TenantsRepository,
      executor as unknown as TenantProvisioningExecutor,
    );
    await expect(
      handler.handle(
        makeMsg("not-json{", 1) as Parameters<TenantProvisionHandler["handle"]>[0],
      ),
    ).rejects.toBeInstanceOf(PermanentError);
  });
});
