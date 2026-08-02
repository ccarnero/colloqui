import "reflect-metadata";
import type { Mock } from "bun:test";
import { describe, expect, it, mock } from "bun:test";
import {
  CHANNEL_STREAM_MAX_AGE_NS,
  CHANNEL_STREAM_MAX_BYTES,
  getTenantStreamName,
  getTenantSubjectPattern,
} from "@yoizen/shared";
import { RetentionPolicy } from "nats";
import {
  ensureStream,
  ensureTenantIngressStream,
  isStreamNotFoundError,
  JetStreamCapacityError,
} from "../../src/nats-provider";

interface StreamInfoStub {
  config: {
    name: string;
    subjects?: readonly string[];
    max_age?: number;
    max_bytes?: number;
  };
}

interface MockJsm {
  streams: {
    info: Mock<(name: string) => Promise<StreamInfoStub>>;
    add: Mock<(cfg: Record<string, unknown>) => Promise<unknown>>;
    update: Mock<
      (name: string, cfg: Record<string, unknown>) => Promise<unknown>
    >;
  };
}

function makeJsmMock(existing: StreamInfoStub | null): MockJsm {
  const info = mock((_name: string): Promise<StreamInfoStub> => {
    if (existing === null) {
      return Promise.reject(new Error("stream not found"));
    }
    return Promise.resolve(existing);
  });
  const add = mock((_cfg: Record<string, unknown>) => Promise.resolve({}));
  const update = mock((_name: string, _cfg: Record<string, unknown>) =>
    Promise.resolve({})
  );

  return { streams: { info, add, update } };
}

describe("ensureStream", () => {
  it("creates the stream with the requested subjects when missing", async () => {
    const jsm = makeJsmMock(null);

    await ensureStream(jsm as never, {
      name: "DLQ",
      subjects: ["dlq.webhook"],
      maxBytes: 1024,
      retention: RetentionPolicy.Limits,
    });

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    expect(jsm.streams.update).not.toHaveBeenCalled();

    const addArgs = jsm.streams.add.mock.calls[0] as [Record<string, unknown>];
    const addCfg = addArgs[0];
    expect(addCfg.name).toBe("DLQ");
    expect(addCfg.subjects).toEqual(["dlq.webhook"]);
    expect(addCfg.max_bytes).toBe(1024);
    expect(addCfg.retention).toBe(RetentionPolicy.Limits);
  });

  it("is a no-op when existing stream matches requested subjects and limits", async () => {
    const jsm = makeJsmMock({
      config: {
        name: "DLQ",
        subjects: ["dlq.webhook"],
        max_age: 1_000,
        max_bytes: 2048,
      },
    });

    await ensureStream(jsm as never, {
      name: "DLQ",
      subjects: ["dlq.webhook"],
      maxAge: 1_000,
      maxBytes: 2048,
    });

    expect(jsm.streams.update).not.toHaveBeenCalled();
    expect(jsm.streams.add).not.toHaveBeenCalled();
  });

  it("reconciles drifted subjects by calling streams.update with the new subject list", async () => {
    const jsm = makeJsmMock({
      config: {
        name: "DLQ",
        subjects: ["dlq.>"],
        max_age: 1_000,
        max_bytes: 2048,
      },
    });

    const warn = mock((_msg: string) => {});
    await ensureStream(jsm as never, {
      name: "DLQ",
      subjects: ["dlq.webhook"],
      maxAge: 1_000,
      maxBytes: 2048,
      logger: { warn },
    });

    expect(jsm.streams.update).toHaveBeenCalledTimes(1);
    const updateArgs = jsm.streams.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(updateArgs[0]).toBe("DLQ");
    expect(updateArgs[1].subjects).toEqual(["dlq.webhook"]);
    expect(updateArgs[1].max_age).toBe(1_000);
    expect(updateArgs[1].max_bytes).toBe(2048);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("updates max_age/max_bytes drift while leaving matching subjects untouched", async () => {
    const jsm = makeJsmMock({
      config: {
        name: "DLQ",
        subjects: ["dlq.webhook"],
        max_age: 500,
        max_bytes: 1024,
      },
    });

    await ensureStream(jsm as never, {
      name: "DLQ",
      subjects: ["dlq.webhook"],
      maxAge: 1_000,
      maxBytes: 2048,
    });

    expect(jsm.streams.update).toHaveBeenCalledTimes(1);
    const [, cfg] = jsm.streams.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(cfg.max_age).toBe(1_000);
    expect(cfg.max_bytes).toBe(2048);
    expect(cfg.subjects).toEqual(["dlq.webhook"]);
  });

  it("treats subject list order as irrelevant (set-equality)", async () => {
    const jsm = makeJsmMock({
      config: {
        name: "MULTI",
        subjects: ["a.b", "c.d"],
      },
    });

    await ensureStream(jsm as never, {
      name: "MULTI",
      subjects: ["c.d", "a.b"],
    });

    expect(jsm.streams.update).not.toHaveBeenCalled();
  });
});

interface MockTenantJsm {
  streams: {
    add: Mock<(cfg: Record<string, unknown>) => Promise<unknown>>;
    list?: Mock<
      () => AsyncIterable<{ config: { name?: string; max_bytes: number } }>
    >;
  };
  getAccountInfo?: Mock<() => Promise<unknown>>;
}

function makeTenantJsmMock(
  add: (cfg: Record<string, unknown>) => Promise<unknown> = (_cfg) =>
    Promise.resolve({})
): MockTenantJsm {
  return { streams: { add: mock(add) } };
}

/**
 * Tenant jsm mock that also answers `getAccountInfo` — only the opt-in
 * `checkCapacity` path calls it. Kept separate from `makeTenantJsmMock` on
 * purpose: the default helper path must never touch the broker for account
 * info, and 27 jsm mocks across the repo do not implement it.
 */
function makeCapacityJsmMock(
  storageUsed: number,
  maxStorage: number,
  existingStreams: Array<{ name?: string; max_bytes: number }> = []
): MockTenantJsm & { getAccountInfo: Mock<() => Promise<unknown>> } {
  return {
    streams: {
      add: mock((_cfg: Record<string, unknown>) => Promise.resolve({})),
      // T03: the capacity pre-flight derives reserved bytes from the
      // account's stream list (the client API has no reserved_storage).
      list: mock(() => ({
        async *[Symbol.asyncIterator]() {
          for (const { name, max_bytes } of existingStreams) {
            yield { config: { name, max_bytes } };
          }
        },
      })),
    },
    getAccountInfo: mock(() =>
      Promise.resolve({
        storage: storageUsed,
        limits: { max_storage: maxStorage },
      })
    ),
  };
}

describe("ensureTenantIngressStream", () => {
  // NOTE: each test uses a unique tenantId so the module-level cache
  // (a `Set<streamName>` keyed by `getTenantStreamName(tenantId)`) does
  // not bleed test state across cases.

  it("ensure-on-miss: calls streams.add with canonical name/subjects/policy", async () => {
    const tenantId = "miss-tenant";
    const jsm = makeTenantJsmMock();

    await ensureTenantIngressStream(jsm as never, tenantId);

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    const [cfg] = jsm.streams.add.mock.calls[0] as [Record<string, unknown>];
    expect(cfg.name).toBe(getTenantStreamName(tenantId));
    expect(cfg.subjects).toEqual([getTenantSubjectPattern(tenantId)]);
    expect(cfg.retention).toBe(RetentionPolicy.Limits);
    expect(cfg.max_age).toBe(CHANNEL_STREAM_MAX_AGE_NS);
    expect(cfg.max_bytes).toBe(CHANNEL_STREAM_MAX_BYTES);
  });

  it("default path never asks the broker for account info (capacity check is opt-in)", async () => {
    // 27 jsm mocks across the repo omit `getAccountInfo`; the 10 production
    // call sites publish on the hot path. The check must stay opt-in so the
    // default ensure keeps its single-round-trip contract.
    const jsm = makeCapacityJsmMock(0, 1_000_000_000);

    await ensureTenantIngressStream(jsm as never, "no-capacity-check-tenant");

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    expect(jsm.getAccountInfo).not.toHaveBeenCalled();
  });

  it("checkCapacity: pre-flights account storage before creating", async () => {
    const jsm = makeCapacityJsmMock(0, 10 * CHANNEL_STREAM_MAX_BYTES);

    await ensureTenantIngressStream(jsm as never, "capacity-ok-tenant", {
      checkCapacity: true,
    });

    expect(jsm.getAccountInfo).toHaveBeenCalledTimes(1);
    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
  });

  it("checkCapacity: throws JetStreamCapacityError and does NOT create when storage is short", async () => {
    // Available = limit - used, below the flat stream's max_bytes.
    const jsm = makeCapacityJsmMock(0, CHANNEL_STREAM_MAX_BYTES - 1);

    let caught: unknown;
    try {
      await ensureTenantIngressStream(jsm as never, "capacity-short-tenant", {
        checkCapacity: true,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(JetStreamCapacityError);
    expect((caught as JetStreamCapacityError).requestedBytes).toBe(
      CHANNEL_STREAM_MAX_BYTES
    );
    expect(jsm.streams.add).not.toHaveBeenCalled();
  });

  it("checkCapacity: a failed check does NOT seed the cache (next call retries)", async () => {
    const tenantId = "capacity-retry-tenant";
    const short = makeCapacityJsmMock(0, CHANNEL_STREAM_MAX_BYTES - 1);
    await ensureTenantIngressStream(short as never, tenantId, {
      checkCapacity: true,
    }).catch(() => {});

    const roomy = makeCapacityJsmMock(0, 10 * CHANNEL_STREAM_MAX_BYTES);
    await ensureTenantIngressStream(roomy as never, tenantId, {
      checkCapacity: true,
    });

    expect(roomy.streams.add).toHaveBeenCalledTimes(1);
  });

  it("ensure-on-hit: subsequent calls for the same tenant skip the broker", async () => {
    const tenantId = "hit-tenant";
    const jsm = makeTenantJsmMock();

    await ensureTenantIngressStream(jsm as never, tenantId);
    await ensureTenantIngressStream(jsm as never, tenantId);
    await ensureTenantIngressStream(jsm as never, tenantId);

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
  });

  it("treats STREAM_NAME_IN_USE (10058) as success and seeds the cache", async () => {
    const tenantId = "existing-tenant";
    const apiErr = Object.assign(new Error("api request failed"), {
      api_error: {
        code: 400,
        err_code: 10058,
        description: "stream name already in use",
      },
    });
    const jsm = makeTenantJsmMock(() => Promise.reject(apiErr));

    await ensureTenantIngressStream(jsm as never, tenantId);
    // Cache should be seeded → second call must NOT hit the broker.
    await ensureTenantIngressStream(jsm as never, tenantId);

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
  });

  it('treats "stream name already in use" message as success when err_code is missing', async () => {
    const tenantId = "existing-msg-tenant";
    const jsm = makeTenantJsmMock(() =>
      Promise.reject(new Error("stream name already in use"))
    );

    await ensureTenantIngressStream(jsm as never, tenantId);
    await ensureTenantIngressStream(jsm as never, tenantId);

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
  });

  it("rethrows other broker errors and does NOT seed the cache", async () => {
    const tenantId = "broken-tenant";
    const jsm = makeTenantJsmMock(() =>
      Promise.reject(new Error("auth failure"))
    );

    await expect(
      ensureTenantIngressStream(jsm as never, tenantId)
    ).rejects.toThrow("auth failure");
    // Cache must remain empty so the next call retries the broker.
    await expect(
      ensureTenantIngressStream(jsm as never, tenantId)
    ).rejects.toThrow("auth failure");

    expect(jsm.streams.add).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent ensures for the same tenant into ONE streams.add", async () => {
    const tenantId = "concurrent-tenant";
    let releaseAdd: (value: unknown) => void = () => {};
    const addPromise = new Promise((resolve) => {
      releaseAdd = resolve;
    });
    const jsm = makeTenantJsmMock(() => addPromise);

    const p1 = ensureTenantIngressStream(jsm as never, tenantId);
    const p2 = ensureTenantIngressStream(jsm as never, tenantId);
    const p3 = ensureTenantIngressStream(jsm as never, tenantId);

    // At this point all three callers must be parked on the SAME
    // in-flight promise — only one streams.add should have been
    // dispatched even though three callers raced to ensure.
    expect(jsm.streams.add).toHaveBeenCalledTimes(1);

    releaseAdd({});
    await Promise.all([p1, p2, p3]);

    // After the barrier releases, the cache is seeded and a follow-up
    // call must short-circuit.
    await ensureTenantIngressStream(jsm as never, tenantId);
    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
  });

  // ── tenant-messaging-tiers T02: caller-resolved tier limits ──────────────

  it("options.limits: applies all four tier limit fields to streams.add verbatim", async () => {
    const tenantId = "tier-limits-tenant";
    const jsm = makeTenantJsmMock();
    const limits = {
      max_age: 14 * 24 * 60 * 60 * 1_000_000_000,
      max_bytes: 5_368_709_120,
      max_msg_size: 1_048_576,
      num_replicas: 1,
      object_store_max_bytes: 2_147_483_648,
    };

    await ensureTenantIngressStream(jsm as never, tenantId, { limits });

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    const [cfg] = jsm.streams.add.mock.calls[0] as [Record<string, unknown>];
    expect(cfg.max_age).toBe(limits.max_age);
    expect(cfg.max_bytes).toBe(limits.max_bytes);
    expect(cfg.max_msg_size).toBe(limits.max_msg_size);
    expect(cfg.num_replicas).toBe(limits.num_replicas);
    // The object-store field is NOT a stream field and must not leak into
    // the stream config (decision 5: claim-check limits stay flat).
    expect("object_store_max_bytes" in cfg).toBe(false);
  });

  it("without options.limits the flat config is byte-for-byte what it always was", async () => {
    const tenantId = "flat-config-tenant";
    const jsm = makeTenantJsmMock();

    await ensureTenantIngressStream(jsm as never, tenantId);

    const [cfg] = jsm.streams.add.mock.calls[0] as [Record<string, unknown>];
    // toStrictEqual so a regression to an unconditional spread emitting
    // `max_msg_size: undefined` cannot slip past the pin.
    expect(cfg).toStrictEqual({
      name: getTenantStreamName(tenantId),
      subjects: [getTenantSubjectPattern(tenantId)],
      retention: RetentionPolicy.Limits,
      max_age: CHANNEL_STREAM_MAX_AGE_NS,
      max_bytes: CHANNEL_STREAM_MAX_BYTES,
    });
  });

  it("checkCapacity pre-flights against options.limits.max_bytes when provided", async () => {
    // Account fits the flat stream but NOT the pro-tier stream — the
    // pre-flight must use the tier's bytes, not the flat constant.
    const proBytes = 5_368_709_120;
    const jsm = makeCapacityJsmMock(0, proBytes - 1);

    let caught: unknown;
    try {
      await ensureTenantIngressStream(jsm as never, "tier-capacity-tenant", {
        checkCapacity: true,
        limits: {
          max_age: 1,
          max_bytes: proBytes,
          max_msg_size: 1,
          num_replicas: 1,
          object_store_max_bytes: 1,
        },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(JetStreamCapacityError);
    expect((caught as JetStreamCapacityError).requestedBytes).toBe(proBytes);
    expect(jsm.streams.add).not.toHaveBeenCalled();
  });

  it("checkCapacity counts RESERVED stream bytes, not just used bytes (T03)", async () => {
    // Regression for the under-count: the account has barely any bytes USED,
    // but existing streams already RESERVE almost the whole account via
    // their max_bytes. The old used-bytes-only check passed here and NATS
    // then rejected the add anyway.
    const maxStorage = 2_147_483_648; // 2 GiB account
    const jsm = makeCapacityJsmMock(
      1_000_000, // ~1 MB actually used
      maxStorage,
      [
        { name: "INGRESS-OTHER-A", max_bytes: 1_073_741_824 },
        { name: "INGRESS-OTHER-B", max_bytes: 1_000_000_000 },
      ] // ~1.93 GiB reserved by OTHER tenants' streams
    );

    let caught: unknown;
    try {
      await ensureTenantIngressStream(jsm as never, "reserved-full-tenant", {
        checkCapacity: true,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(JetStreamCapacityError);
    expect((caught as JetStreamCapacityError).message).toContain("reserved");
    expect(jsm.streams.add).not.toHaveBeenCalled();
  });

  it("checkCapacity still passes when reservations leave room for the request", async () => {
    const jsm = makeCapacityJsmMock(0, 10 * CHANNEL_STREAM_MAX_BYTES, [
      { name: "INGRESS-OTHER-A", max_bytes: CHANNEL_STREAM_MAX_BYTES },
      { name: "INGRESS-OTHER-B", max_bytes: CHANNEL_STREAM_MAX_BYTES },
    ]);

    await ensureTenantIngressStream(jsm as never, "reserved-roomy-tenant", {
      checkCapacity: true,
    });

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
  });

  it("checkCapacity treats an EXISTING target stream as satisfied even on a reservation-full account (T03 round-1 fix)", async () => {
    // The tenant's own stream is part of the reservations. Pre-fix, a pod
    // restart on a well-reserved account made this idempotent re-ensure
    // throw a capacity error BEFORE reaching the STREAM_NAME_IN_USE branch —
    // a permanent 503 for a tenant that needed no capacity at all.
    const tenantId = "reserved-existing-tenant";
    const maxStorage = 2_147_483_648;
    const jsm = makeCapacityJsmMock(1_000_000, maxStorage, [
      { name: "INGRESS-OTHER-A", max_bytes: 1_073_741_824 },
      // The target itself, already reserving its share of the account.
      { name: getTenantStreamName(tenantId), max_bytes: 1_073_741_824 },
    ]);

    await ensureTenantIngressStream(jsm as never, tenantId, {
      checkCapacity: true,
    });

    // Satisfied without touching add; the cache is seeded so the follow-up
    // ensure is a pure no-op (no second account/list round-trip either).
    expect(jsm.streams.add).not.toHaveBeenCalled();
    await ensureTenantIngressStream(jsm as never, tenantId, {
      checkCapacity: true,
    });
    expect(jsm.getAccountInfo).toHaveBeenCalledTimes(1);
  });

  it("checkCapacity skips the reservation scan on an unlimited account", async () => {
    // max_storage -1 means the capacity check cannot fail; the reorder must
    // not pay the streams.list round-trip and must fall through to the
    // idempotent add, byte-identical to pre-T03 behavior.
    const jsm = makeCapacityJsmMock(0, -1, [
      { name: "INGRESS-OTHER-A", max_bytes: 1_073_741_824 },
    ]);

    await ensureTenantIngressStream(jsm as never, "unlimited-account-tenant", {
      checkCapacity: true,
    });

    expect(jsm.streams.list).not.toHaveBeenCalled();
    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
  });
});

describe("isStreamNotFoundError (TMT T04)", () => {
  it("matches the structured broker error by err_code 10059, message aside", () => {
    const brokerError = Object.assign(new Error("whatever the server says"), {
      api_error: { err_code: 10059 },
    });
    expect(isStreamNotFoundError(brokerError)).toBe(true);
  });

  it("falls back to the message substring when the payload is stripped", () => {
    expect(isStreamNotFoundError(new Error("stream not found"))).toBe(true);
  });

  it("does NOT match transport-style errors — they must propagate", () => {
    expect(isStreamNotFoundError(new Error("CONNECTION_REFUSED"))).toBe(false);
    expect(
      isStreamNotFoundError(
        Object.assign(new Error("timeout"), { api_error: { err_code: 10058 } })
      )
    ).toBe(false);
  });
});
