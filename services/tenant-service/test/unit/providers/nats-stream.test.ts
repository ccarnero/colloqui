import { describe, it, expect, mock, beforeEach } from "bun:test";
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
    getAccountInfo: mock(() =>
      Promise.resolve({
        storage: 0,
        limits: { max_storage: -1 },
      }),
    ),
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

describe("NatsTenantProvisioner - createStream", () => {
  let provisioner: NatsTenantProvisioner;
  let mockJsm: JetStreamManager;
  let mockNc: NatsConnection;

  beforeEach(() => {
    mockJsm = createMockJsm();
    mockNc = createMockNc(mockJsm);
    provisioner = new NatsTenantProvisioner(mockNc);
  });

  it("should create INGRESS-ACME stream with pro tier limits", async () => {
    await provisioner.createStream("acme", "pro");

    expect(mockJsm.streams.add).toHaveBeenCalled();
    const call = (mockJsm.streams.add as ReturnType<
      typeof mock
    >).mock.calls[0][0];

    expect(call.name).toBe("INGRESS-ACME");
    expect(call.subjects).toEqual(["evt.acme.>"]);
    expect(call.max_bytes).toBe(
      STREAM_LIMITS.pro.maxBytes,
    );
    expect(call.storage).toBe("file");
    expect(call.discard).toBe("old");
  });

  it("should create stream with free tier limits", async () => {
    await provisioner.createStream("free-tenant", "free");

    const call = (mockJsm.streams.add as ReturnType<
      typeof mock
    >).mock.calls[0][0];

    expect(call.name).toBe("INGRESS-FREE-TENANT");
    expect(call.max_bytes).toBe(
      STREAM_LIMITS.free.maxBytes,
    );
  });

  it("should create stream with enterprise tier limits", async () => {
    await provisioner.createStream("bigcorp", "enterprise");

    const call = (mockJsm.streams.add as ReturnType<
      typeof mock
    >).mock.calls[0][0];

    expect(call.name).toBe("INGRESS-BIGCORP");
    expect(call.max_bytes).toBe(
      STREAM_LIMITS.enterprise.maxBytes,
    );
  });

  it("should set subject filter to evt.{tenant}.>", async () => {
    await provisioner.createStream("acme", "pro");

    const call = (mockJsm.streams.add as ReturnType<
      typeof mock
    >).mock.calls[0][0];

    expect(call.subjects).toEqual(["evt.acme.>"]);
  });

  it("should set max_age based on tier retention", async () => {
    await provisioner.createStream("acme", "pro");

    const call = (mockJsm.streams.add as ReturnType<
      typeof mock
    >).mock.calls[0][0];

    const expectedNs = 14 * 24 * 60 * 60 * 1_000_000_000;
    expect(call.max_age).toBe(expectedNs);
  });
});
