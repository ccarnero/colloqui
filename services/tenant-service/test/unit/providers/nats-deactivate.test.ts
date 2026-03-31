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
} from "../../../src/providers/nats.provider";

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

function createMockNc(
  jsm: JetStreamManager,
): NatsConnection {
  return {
    jetstreamManager: mock(() => Promise.resolve(jsm)),
    objectStore: mock(() =>
      Promise.resolve({
        status: mock(() => Promise.resolve({})),
      }),
    ),
    close: mock(() => Promise.resolve()),
  } as unknown as NatsConnection;
}

describe("NatsTenantProvisioner - deactivateAccount", () => {
  let provisioner: NatsTenantProvisioner;
  let mockJsm: JetStreamManager;
  let mockNc: NatsConnection;

  beforeEach(() => {
    mockJsm = createMockJsm();
    mockNc = createMockNc(mockJsm);
    provisioner = new NatsTenantProvisioner(mockNc);
  });

  it("should delete the INGRESS stream when deactivating", async () => {
    await provisioner.deactivateAccount("acme");

    expect(mockJsm.streams.delete).toHaveBeenCalledWith(
      "INGRESS-acme",
    );
  });

  it("should handle missing stream gracefully", async () => {
    mockJsm.streams.delete = mock(() =>
      Promise.reject(new Error("stream not found")),
    );

    await expect(
      provisioner.deactivateAccount("acme"),
    ).resolves.toBeUndefined();
  });
});
