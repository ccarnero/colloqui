import "../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { ProvisioningStatus } from "@yoizen/shared";
import { PermanentError } from "@yoizen/shared";
import { TenantProvisionHandler } from "../../src/modules/provisioning/tenant-provision-handler.service";
import { TenantProvisioningExecutor } from "../../src/modules/provisioning/tenant-provisioning-executor.service";
import type { ITenantsRepository } from "../../src/modules/tenants/tenants.repository.interface";
import { TenantReadyPublisher } from "../../src/providers/tenant-ready-publisher.service";

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

interface ReadyPublisherStub {
  publishTenantReady: ReturnType<typeof mock>;
}

function noopReadyPublisher(): ReadyPublisherStub {
  return { publishTenantReady: mock(() => undefined) };
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
    const readyPublisher = noopReadyPublisher();
    const handler = new TenantProvisionHandler(
      repository as unknown as ITenantsRepository,
      executor as unknown as TenantProvisioningExecutor,
      readyPublisher as unknown as TenantReadyPublisher,
    );
    await handler.handle(
      makeMsg(validPayload, 1) as Parameters<TenantProvisionHandler["handle"]>[0],
    );
    expect(executor.run).not.toHaveBeenCalled();
    // Idempotent ack must NOT re-publish the ready event.
    expect(readyPublisher.publishTenantReady).not.toHaveBeenCalled();
  });

  it("runs executor and marks ready on success", async () => {
    const repository = {
      findById: mock(() =>
        Promise.resolve({
          id: "tid-1",
          name: "acme",
          tier: "shared",
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
    const readyPublisher = noopReadyPublisher();
    const handler = new TenantProvisionHandler(
      repository as unknown as ITenantsRepository,
      executor as unknown as TenantProvisioningExecutor,
      readyPublisher as unknown as TenantReadyPublisher,
    );
    await handler.handle(
      makeMsg(validPayload, 1) as Parameters<TenantProvisionHandler["handle"]>[0],
    );
    expect(repository.markProvisioningStarted).toHaveBeenCalled();
    expect(executor.run).toHaveBeenCalled();
    expect(repository.markProvisioningReady).toHaveBeenCalled();
    // ready event must fire exactly once with the row's id/name/tier
    expect(readyPublisher.publishTenantReady).toHaveBeenCalledTimes(1);
    expect(readyPublisher.publishTenantReady).toHaveBeenCalledWith({
      tenantId: "tid-1",
      name: "acme",
      tier: "shared",
    });
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
    const readyPublisher = noopReadyPublisher();
    const handler = new TenantProvisionHandler(
      repository as unknown as ITenantsRepository,
      executor as unknown as TenantProvisioningExecutor,
      readyPublisher as unknown as TenantReadyPublisher,
    );
    await expect(
      handler.handle(
        makeMsg(validPayload, 2) as Parameters<TenantProvisionHandler["handle"]>[0],
      ),
    ).rejects.toThrow("transient");
    expect(repository.markProvisioningFailed).not.toHaveBeenCalled();
    // Failed/transient runs must NOT publish the ready event.
    expect(readyPublisher.publishTenantReady).not.toHaveBeenCalled();
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
    const readyPublisher = noopReadyPublisher();
    const handler = new TenantProvisionHandler(
      repository as unknown as ITenantsRepository,
      executor as unknown as TenantProvisioningExecutor,
      readyPublisher as unknown as TenantReadyPublisher,
    );
    await expect(
      handler.handle(
        makeMsg(validPayload, 5) as Parameters<TenantProvisionHandler["handle"]>[0],
      ),
    ).rejects.toBeInstanceOf(PermanentError);
    expect(repository.markProvisioningFailed).toHaveBeenCalled();
    expect(readyPublisher.publishTenantReady).not.toHaveBeenCalled();
  });

  it("throws PermanentError for invalid JSON", async () => {
    const repository = { findById: mock(() => Promise.resolve(undefined)) };
    const executor = { run: mock(() => Promise.resolve()) };
    const readyPublisher = noopReadyPublisher();
    const handler = new TenantProvisionHandler(
      repository as unknown as ITenantsRepository,
      executor as unknown as TenantProvisioningExecutor,
      readyPublisher as unknown as TenantReadyPublisher,
    );
    await expect(
      handler.handle(
        makeMsg("not-json{", 1) as Parameters<TenantProvisionHandler["handle"]>[0],
      ),
    ).rejects.toBeInstanceOf(PermanentError);
    expect(readyPublisher.publishTenantReady).not.toHaveBeenCalled();
  });
});
