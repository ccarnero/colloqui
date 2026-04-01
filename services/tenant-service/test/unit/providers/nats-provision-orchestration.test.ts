import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { NatsConnection, JetStreamManager } from "nats";
import { STREAM_LIMITS, type TenantTier } from "../../../src/providers/nats.provider";
import { TENANT_TIER_LIMITS } from "@yoizen/shared";

function tierMaxAgeNs(tier: TenantTier): number {
  return TENANT_TIER_LIMITS[tier].max_age;
}

describe("NatsTenantProvisioner - provisionYoizenClaw orchestration", () => {
  it("should provision account, stream, object store, and ACLs in sequence", async () => {
    const osFn = mock(() =>
      Promise.resolve({
        status: mock(() => Promise.resolve({})),
      }),
    );

    const addFn = mock(() => Promise.resolve({}));
    const infoFn = mock(() =>
      Promise.reject({ code: 404 }),
    );
    const deleteFn = mock(() => Promise.resolve({}));
    const mockJsm = {
      streams: { info: infoFn, add: addFn, delete: deleteFn },
      consumers: { add: mock(() => Promise.resolve({})) },
      getAccountInfo: mock(() =>
        Promise.resolve({
          storage: 0,
          limits: { max_storage: -1 },
        }),
      ),
    } as unknown as JetStreamManager;

    const mockNc = {
      jetstreamManager: mock(() =>
        Promise.resolve(mockJsm),
      ),
      jetstream: mock(() => ({
        views: { os: osFn },
      })),
      close: mock(() => Promise.resolve()),
    } as unknown as NatsConnection;

    const { NatsTenantProvisioner } = await import(
      "../../../src/providers/nats.provider"
    );
    const provisioner = new NatsTenantProvisioner(mockNc);

    await provisioner.createAccount("acme");
    await provisioner.createStream("acme", "pro");
    await provisioner.createObjectStore("acme", "pro");
    const aclConfig = await provisioner.createACLs(
      "acme",
      ["ingress-service", "admin-service"],
    );

    expect(infoFn).toHaveBeenCalledWith("INGRESS-ACME");
    expect(addFn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "INGRESS-ACME",
        subjects: ["evt.acme.>"],
        max_bytes: STREAM_LIMITS.pro.maxBytes,
      }),
    );
    expect(osFn).toHaveBeenCalledWith(
      "PAYLOAD-ACME",
      expect.objectContaining({
        ttl: tierMaxAgeNs("pro"),
        max_bytes: TENANT_TIER_LIMITS.pro.object_store_max_bytes,
      }),
    );
    expect(aclConfig.tenantId).toBe("acme");
    expect(aclConfig.publishAllow).toEqual(["evt.acme.>"]);
    expect(aclConfig.crossTenantDeny).toEqual(["evt.*.>"]);
  });
});
