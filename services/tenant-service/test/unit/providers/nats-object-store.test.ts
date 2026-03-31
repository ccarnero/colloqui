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

describe("NatsTenantProvisioner - createObjectStore", () => {
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

  it("should create PAYLOAD-acme bucket with TTL", async () => {
    await provisioner.createObjectStore("acme", "pro");

    expect(osFn).toHaveBeenCalled();
    expect(osFn.mock.calls[0][0]).toBe("PAYLOAD-acme");
    const opts = osFn.mock.calls[0][1] as { ttl: number };
    expect(opts.ttl).toBeGreaterThan(0);
  });

  it("should set TTL aligned to stream retention for free tier", async () => {
    await provisioner.createObjectStore("free-tenant", "free");

    const opts = osFn.mock.calls[0][1] as { ttl: number };
    const expectedNs =
      BigInt(7 * 86_400_000) * 1_000_000n;
    expect(opts.ttl).toBe(Number(expectedNs));
  });

  it("should set TTL aligned to stream retention for pro tier", async () => {
    await provisioner.createObjectStore("acme", "pro");

    const opts = osFn.mock.calls[0][1] as { ttl: number };
    const expectedNs =
      BigInt(14 * 86_400_000) * 1_000_000n;
    expect(opts.ttl).toBe(Number(expectedNs));
  });

  it("should set TTL aligned to stream retention for enterprise tier", async () => {
    await provisioner.createObjectStore(
      "bigcorp",
      "enterprise",
    );

    const opts = osFn.mock.calls[0][1] as { ttl: number };
    const expectedNs =
      BigInt(30 * 86_400_000) * 1_000_000n;
    expect(opts.ttl).toBe(Number(expectedNs));
  });

  it("should create bucket with 5GB max size", async () => {
    await provisioner.createObjectStore("acme", "pro");

    const opts = osFn.mock.calls[0][1] as {
      max_bytes: number;
    };
    expect(opts.max_bytes).toBe(5_000_000_000);
  });
});
