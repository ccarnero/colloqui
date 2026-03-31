import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { NatsConnection, JetStreamManager } from "nats";
import { STREAM_LIMITS, type TenantTier } from "../../../src/providers/nats.provider";

const NS_PER_MS = 1_000_000n;
const MS_PER_DAY = 86_400_000;

function tierMaxAgeNs(tier: TenantTier): number {
  return Number(
    BigInt(STREAM_LIMITS[tier].maxAgeDays * MS_PER_DAY) *
      NS_PER_MS,
  );
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

    expect(infoFn).toHaveBeenCalledWith("INGRESS-acme");
    expect(addFn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "INGRESS-acme",
        subjects: ["evt.acme.>"],
        max_bytes: STREAM_LIMITS.pro.maxBytes,
      }),
    );
    expect(osFn).toHaveBeenCalledWith(
      "PAYLOAD-acme",
      expect.objectContaining({
        ttl: tierMaxAgeNs("pro"),
        max_bytes: 5_000_000_000,
      }),
    );
    expect(aclConfig.tenantId).toBe("acme");
    expect(aclConfig.publishAllow).toEqual(["evt.acme.>"]);
    expect(aclConfig.crossTenantDeny).toEqual(["evt.*.>"]);
  });
});
