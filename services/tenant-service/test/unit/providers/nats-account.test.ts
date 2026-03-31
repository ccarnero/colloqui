import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { NatsConnection, JetStreamManager } from "nats";
import { NatsTenantProvisioner } from "../../../src/providers/nats.provider";

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
    jetstream: mock(() => ({
      views: {
        os: mock(() =>
          Promise.resolve({
            status: mock(() => Promise.resolve({})),
          }),
        ),
      },
    })),
    close: mock(() => Promise.resolve()),
  } as unknown as NatsConnection;
}

describe("NatsTenantProvisioner - createAccount", () => {
  let provisioner: NatsTenantProvisioner;
  let mockJsm: JetStreamManager;
  let mockNc: NatsConnection;

  beforeEach(() => {
    mockJsm = createMockJsm();
    mockNc = createMockNc(mockJsm);
    provisioner = new NatsTenantProvisioner(mockNc);
  });

  it("should create NATS account for tenant when no stream exists", async () => {
    await provisioner.createAccount("acme");

    expect(mockNc.jetstreamManager).toHaveBeenCalled();
    expect(mockJsm.streams.info).toHaveBeenCalledWith(
      "INGRESS-acme",
    );
  });

  it("should warn and return if account stream already exists", async () => {
    mockJsm.streams.info = mock(() =>
      Promise.resolve({ config: { name: "INGRESS-acme" } }),
    );

    await provisioner.createAccount("acme");

    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });

  it("should throw on unexpected error from streams.info", async () => {
    mockJsm.streams.info = mock(() =>
      Promise.reject(new Error("connection refused")),
    );

    expect(provisioner.createAccount("acme")).rejects.toThrow(
      "connection refused",
    );
  });
});
