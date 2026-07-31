import "reflect-metadata";
import { describe, it, expect, mock } from "bun:test";
import type { Mock } from "bun:test";
import { RetentionPolicy } from "nats";
import {
  CHANNEL_STREAM_MAX_AGE_NS,
  CHANNEL_STREAM_MAX_BYTES,
  getTenantStreamName,
  getTenantSubjectPattern,
} from "@yoizen/shared";
import {
  ensureStream,
  ensureTenantIngressStream,
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
    if (existing === null) return Promise.reject(new Error("stream not found"));
    return Promise.resolve(existing);
  });
  const add = mock((_cfg: Record<string, unknown>) => Promise.resolve({}));
  const update = mock(
    (_name: string, _cfg: Record<string, unknown>) => Promise.resolve({}),
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
  };
  getAccountInfo?: Mock<() => Promise<unknown>>;
}

function makeTenantJsmMock(
  add: (cfg: Record<string, unknown>) => Promise<unknown> = (_cfg) =>
    Promise.resolve({}),
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
): MockTenantJsm & { getAccountInfo: Mock<() => Promise<unknown>> } {
  return {
    streams: { add: mock((_cfg: Record<string, unknown>) => Promise.resolve({})) },
    getAccountInfo: mock(() =>
      Promise.resolve({ storage: storageUsed, limits: { max_storage: maxStorage } }),
    ),
  };
}

describe("ensureTenantIngressStream", () => {
  // NOTE: each test uses a unique tenantId so the module-level cache
  // (a `Set<streamName>` keyed by `getTenantStreamName(tenantId)`) does
  // not bleed test state across cases.

  it(
    "ensure-on-miss: calls streams.add with canonical name/subjects/policy",
    async () => {
      const tenantId = "miss-tenant";
      const jsm = makeTenantJsmMock();

      await ensureTenantIngressStream(jsm as never, tenantId);

      expect(jsm.streams.add).toHaveBeenCalledTimes(1);
      const [cfg] = jsm.streams.add.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(cfg.name).toBe(getTenantStreamName(tenantId));
      expect(cfg.subjects).toEqual([getTenantSubjectPattern(tenantId)]);
      expect(cfg.retention).toBe(RetentionPolicy.Limits);
      expect(cfg.max_age).toBe(CHANNEL_STREAM_MAX_AGE_NS);
      expect(cfg.max_bytes).toBe(CHANNEL_STREAM_MAX_BYTES);
    },
  );

  it(
    "default path never asks the broker for account info (capacity check is opt-in)",
    async () => {
      // 27 jsm mocks across the repo omit `getAccountInfo`; the 10 production
      // call sites publish on the hot path. The check must stay opt-in so the
      // default ensure keeps its single-round-trip contract.
      const jsm = makeCapacityJsmMock(0, 1_000_000_000);

      await ensureTenantIngressStream(jsm as never, "no-capacity-check-tenant");

      expect(jsm.streams.add).toHaveBeenCalledTimes(1);
      expect(jsm.getAccountInfo).not.toHaveBeenCalled();
    },
  );

  it(
    "checkCapacity: pre-flights account storage before creating",
    async () => {
      const jsm = makeCapacityJsmMock(0, 10 * CHANNEL_STREAM_MAX_BYTES);

      await ensureTenantIngressStream(jsm as never, "capacity-ok-tenant", {
        checkCapacity: true,
      });

      expect(jsm.getAccountInfo).toHaveBeenCalledTimes(1);
      expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    },
  );

  it(
    "checkCapacity: throws JetStreamCapacityError and does NOT create when storage is short",
    async () => {
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
        CHANNEL_STREAM_MAX_BYTES,
      );
      expect(jsm.streams.add).not.toHaveBeenCalled();
    },
  );

  it(
    "checkCapacity: a failed check does NOT seed the cache (next call retries)",
    async () => {
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
    },
  );

  it(
    "ensure-on-hit: subsequent calls for the same tenant skip the broker",
    async () => {
      const tenantId = "hit-tenant";
      const jsm = makeTenantJsmMock();

      await ensureTenantIngressStream(jsm as never, tenantId);
      await ensureTenantIngressStream(jsm as never, tenantId);
      await ensureTenantIngressStream(jsm as never, tenantId);

      expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    },
  );

  it(
    "treats STREAM_NAME_IN_USE (10058) as success and seeds the cache",
    async () => {
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
    },
  );

  it(
    'treats "stream name already in use" message as success when err_code is missing',
    async () => {
      const tenantId = "existing-msg-tenant";
      const jsm = makeTenantJsmMock(() =>
        Promise.reject(new Error("stream name already in use")),
      );

      await ensureTenantIngressStream(jsm as never, tenantId);
      await ensureTenantIngressStream(jsm as never, tenantId);

      expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    },
  );

  it(
    "rethrows other broker errors and does NOT seed the cache",
    async () => {
      const tenantId = "broken-tenant";
      const jsm = makeTenantJsmMock(() =>
        Promise.reject(new Error("auth failure")),
      );

      await expect(
        ensureTenantIngressStream(jsm as never, tenantId),
      ).rejects.toThrow("auth failure");
      // Cache must remain empty so the next call retries the broker.
      await expect(
        ensureTenantIngressStream(jsm as never, tenantId),
      ).rejects.toThrow("auth failure");

      expect(jsm.streams.add).toHaveBeenCalledTimes(2);
    },
  );

  it(
    "coalesces concurrent ensures for the same tenant into ONE streams.add",
    async () => {
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
    },
  );
});
