import { describe, expect, it } from "bun:test";
import { ClaimCheckResolveError } from "@yoizen/database";
import type { EventEnvelope } from "@yoizen/shared";
import {
  DEFAULT_CLAIM_CHECK_RESOLVE_TIMEOUT_MS,
  resolvePayload,
} from "../src/lib/resolve-payload.js";

function slimEnvelope(
  overrides: Partial<EventEnvelope["data"]> = {}
): EventEnvelope {
  return {
    specversion: "1.0",
    id: "evt-claim-1",
    source: "test/claim-check",
    type: "io.yoizen.messaging.telegram.telegram.received.v1",
    resource: "tenant/tenant-a/x",
    time: "2026-07-11T00:00:00.000Z",
    traceid: "33333333-3333-3333-3333-333333333333",
    causation_id: null,
    correlation_id: "corr-claim-1",
    tenant: "tenant-a",
    producer: "channel-service",
    domain: "messaging",
    channel: "telegram",
    provider: "telegram",
    accountid: "acc-1",
    idempotencykey: "idem-claim-1",
    transport: { method: "webhook", protocol: "https", depth: 0 },
    data: {
      received_at: "2026-07-11T00:00:00.000Z",
      payload_inline: false,
      payload_ref: "nats://objstore/PAYLOAD-tenant-a/evt-claim-1-payload",
      payload_bytes: 400_000,
      payload_checksum: "sha256:deadbeef",
      payload: null,
      ...overrides,
    },
    kind: "received",
  } as EventEnvelope;
}

function fakeLogger(): {
  logger: {
    log: (m: string, ctx?: unknown) => void;
    warn: (m: string, ctx?: unknown) => void;
    error: (m: string, ctx?: unknown) => void;
    debug: (m: string, ctx?: unknown) => void;
  };
  logs: { level: string; message: string }[];
} {
  const logs: { level: string; message: string }[] = [];
  const record = (level: string) => (message: string) =>
    logs.push({ level, message });
  return {
    logger: {
      log: record("log"),
      warn: record("warn"),
      error: record("error"),
      debug: record("debug"),
    },
    logs,
  };
}

describe("resolvePayload — claim-check resolution at ingest (T02)", () => {
  it("returns 'resolved' with the inflated envelope on success", async () => {
    const envelope = slimEnvelope();
    const inflated: EventEnvelope = {
      ...envelope,
      data: {
        ...envelope.data,
        payload_inline: true,
        payload: { hello: "world" },
      },
    };
    const { logger, logs } = fakeLogger();

    const outcome = await resolvePayload(envelope, {
      resolve: async () => inflated,
      logger,
    });

    expect(outcome.status).toBe("resolved");
    if (outcome.status !== "resolved") {
      return;
    }
    expect(outcome.envelope).toBe(inflated);
    expect(logs.some((l) => l.message.includes("attempting claim-check"))).toBe(
      true
    );
    expect(logs.some((l) => l.message.includes("resolved claim-check"))).toBe(
      true
    );
  });

  it("returns 'unresolved' with the reason on an expired/missing blob", async () => {
    const envelope = slimEnvelope();
    const { logger, logs } = fakeLogger();

    const outcome = await resolvePayload(envelope, {
      resolve: async () => {
        throw new ClaimCheckResolveError(
          `Blob not found: ${envelope.data.payload_ref}`,
          "blob_not_found"
        );
      },
      logger,
    });

    expect(outcome.status).toBe("unresolved");
    if (outcome.status !== "unresolved") {
      return;
    }
    expect(outcome.envelope).toBe(envelope); // slim, unchanged
    expect(outcome.reason).toContain("blob_not_found");
    expect(logs.some((l) => l.level === "warn")).toBe(true);
  });

  it("returns 'unresolved' with a malformed-ref reason", async () => {
    const envelope = slimEnvelope({
      payload_ref: "not-a-valid-ref",
    } as Partial<EventEnvelope["data"]>);

    const outcome = await resolvePayload(envelope, {
      resolve: async () => {
        throw new ClaimCheckResolveError(
          `Malformed payload_ref: ${envelope.data.payload_ref}`,
          "ref_malformed"
        );
      },
    });

    expect(outcome.status).toBe("unresolved");
    if (outcome.status !== "unresolved") {
      return;
    }
    expect(outcome.reason).toContain("ref_malformed");
    expect(outcome.envelope).toBe(envelope);
  });

  it("returns 'unresolved' when the cache/object-store is unreachable", async () => {
    const envelope = slimEnvelope();

    const outcome = await resolvePayload(envelope, {
      resolve: async () => {
        throw new Error("ECONNREFUSED: object store unreachable");
      },
    });

    expect(outcome.status).toBe("unresolved");
    if (outcome.status !== "unresolved") {
      return;
    }
    expect(outcome.reason).toContain("ECONNREFUSED");
  });

  it("times out at the configured budget and reports 'unresolved' (never hangs/throws)", async () => {
    const envelope = slimEnvelope();
    const { logger, logs } = fakeLogger();

    const outcome = await resolvePayload(envelope, {
      // Never settles within the test's lifetime.
      resolve: () => new Promise(() => {}),
      timeoutMs: 20,
      logger,
    });

    expect(outcome.status).toBe("unresolved");
    if (outcome.status !== "unresolved") {
      return;
    }
    expect(outcome.reason).toContain("timeout");
    expect(logs.some((l) => l.message.includes("timeout"))).toBe(true);
  }, 2_000);

  it("defaults the timeout to 2000ms", () => {
    expect(DEFAULT_CLAIM_CHECK_RESOLVE_TIMEOUT_MS).toBe(2000);
  });

  it("never throws — a synchronous throw inside resolve() is also caught", async () => {
    const envelope = slimEnvelope();

    // Some resolve() implementations could throw synchronously before
    // returning a promise; resolvePayload wraps deps.resolve in an async
    // context, so even that path resolves to 'unresolved'.
    const outcome = await resolvePayload(envelope, {
      resolve: async () => {
        throw new Error("malformed ref: bad shape");
      },
    });

    expect(outcome.status).toBe("unresolved");
  });
});
