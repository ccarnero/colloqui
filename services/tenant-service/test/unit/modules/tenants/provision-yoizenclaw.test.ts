import {
  describe,
  it,
  expect,
  mock,
  beforeEach,
} from "bun:test";
import type { NatsConnection, JetStreamManager } from "nats";
import {
  NatsTenantProvisioner,
  STREAM_LIMITS,
  type TenantTier,
} from "../../../../src/providers/nats.provider";

function createMockJsm(): JetStreamManager {
  return {
    streams: {
      info: mock(() => Promise.reject({ code: 404 })),
      add: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
    consumers: {
      add: mock(() => Promise.resolve({})),
    },
  } as unknown as JetStreamManager;
}

function createMockOsFn(): ReturnType<typeof mock> {
  return mock(() =>
    Promise.resolve({
      status: mock(() => Promise.resolve({})),
    }),
  );
}

function createMockNc(
  jsm: JetStreamManager,
  osFn: ReturnType<typeof mock>,
): NatsConnection {
  return {
    jetstreamManager: mock(() => Promise.resolve(jsm)),
    jetstream: mock(() => ({
      views: { os: osFn },
    })),
    close: mock(() => Promise.resolve()),
  } as unknown as NatsConnection;
}

describe("provisionYoizenClaw endpoint integration", () => {
  let provisioner: NatsTenantProvisioner;
  let mockJsm: JetStreamManager;
  let mockNc: NatsConnection;
  let osFn: ReturnType<typeof mock>;

  beforeEach(() => {
    mockJsm = createMockJsm();
    osFn = createMockOsFn();
    mockNc = createMockNc(mockJsm, osFn);
    provisioner = new NatsTenantProvisioner(mockNc);
  });

  async function provisionYoizenClaw(
    tenantId: string,
    tier: TenantTier,
  ): Promise<void> {
    await provisioner.createAccount(tenantId);
    await provisioner.createStream(tenantId, tier);
    await provisioner.createObjectStore(tenantId, tier);
    await provisioner.createACLs(tenantId, [
      "ingress-service",
      "admin-service",
    ]);
  }

  it("should provision full YoizenClaw stack for pro tier", async () => {
    await provisionYoizenClaw("acme", "pro");

    expect(mockJsm.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "INGRESS-acme",
        subjects: ["evt.acme.>"],
      }),
    );
    expect(osFn).toHaveBeenCalledWith(
      "PAYLOAD-acme",
      expect.objectContaining({
        ttl: expect.any(Number),
      }),
    );
  });

  it("should provision with free tier limits", async () => {
    await provisionYoizenClaw("free-tenant", "free");

    expect(mockJsm.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "INGRESS-free-tenant",
        max_bytes: 1_000_000_000,
      }),
    );
  });

  it("should provision with enterprise tier limits", async () => {
    await provisionYoizenClaw("bigcorp", "enterprise");

    expect(mockJsm.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "INGRESS-bigcorp",
        max_bytes: 20_000_000_000,
      }),
    );
  });
});
