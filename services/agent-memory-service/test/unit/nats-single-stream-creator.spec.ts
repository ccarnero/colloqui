import "../setup-env";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ServiceUnavailableException } from "@nestjs/common";
import {
  CHANNEL_STREAM_MAX_AGE_NS,
  CHANNEL_STREAM_MAX_BYTES,
  TENANT_TIER_LIMITS,
} from "@yoizen/shared";
import {
  MemoryKind,
  MemoryScope,
  MemoryStatus,
} from "../../src/modules/memory/domain/enums";
import type { IMemory } from "../../src/modules/memory/domain/memory.entity";
import { NatsPublisher } from "../../src/providers/nats.provider";

/**
 * Single stream creator (envelope-drift post-loop item 6).
 *
 * `INGRESS-<TENANT>` had TWO creators with DIFFERENT configs:
 *   - `ensureTenantIngressStream` (packages/database) — flat limits:
 *     max_age 7d, max_bytes 256 MiB, no max_msg_size cap.
 *   - this service (and agent-admin) via
 *     `buildTenantStreamConfig(tenantId, "free")` — 1 GiB and a 1 MiB
 *     max_msg_size cap.
 *
 * Same stream name, so whichever service touched a new tenant first decided
 * its limits — non-deterministic, and invisible because both paths treat
 * "already exists" as success. This service no longer calls `streams.add`;
 * it delegates to the shared helper, which is now the only creator.
 *
 * Tier-aware limits remain the FUTURE design:
 * `DOCS/messaging/tenant-messaging-tiers.md`.
 */

function createMemory(overrides?: Partial<IMemory>): IMemory {
  return {
    id: "mem-1",
    tenantId: "tenant-1",
    scope: MemoryScope.TENANT,
    kind: MemoryKind.FACT,
    status: MemoryStatus.PROPOSED,
    title: "T",
    content: "c",
    metadata: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("NatsPublisher stream creation", () => {
  const publishMock = mock(() => Promise.resolve({ seq: 1 }));
  const streamsAdd = mock((_cfg: unknown) => Promise.resolve({}));
  const streamsInfo = mock((_name: string) =>
    Promise.reject(new Error("stream not found"))
  );
  const getAccountInfo = mock(() =>
    Promise.resolve({ storage: 0, limits: { max_storage: 10_000_000_000 } })
  );

  const fakeLazyNats = {
    jetstreamManager: () =>
      Promise.resolve({
        streams: {
          info: streamsInfo,
          add: streamsAdd,
          // T03: the capacity pre-flight sums reserved bytes via streams.list.
          list: () => ({
            async *[Symbol.asyncIterator]() {},
          }),
        },
        getAccountInfo,
      }),
    jetstream: () => Promise.resolve({ publish: publishMock }),
    close: () => Promise.resolve(),
  };

  let publisher: NatsPublisher;

  beforeEach(() => {
    publishMock.mockClear();
    streamsAdd.mockClear();
    streamsInfo.mockClear();
    getAccountInfo.mockClear();
    publisher = new NatsPublisher(
      fakeLazyNats as unknown as ConstructorParameters<typeof NatsPublisher>[0]
    );
  });

  it("creates the ingress stream with the FLAT config, never tier limits", async () => {
    // The stream is reported MISSING — exactly when the old code called
    // streams.add itself with free-tier limits. The add still happens, but it
    // now comes from the shared helper, so the CONFIG is the single flat one.
    await publisher.publishMemoryProposed(
      "tenant-single-creator",
      createMemory()
    );

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(streamsAdd).toHaveBeenCalledTimes(1);

    const [cfg] = streamsAdd.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(cfg.max_bytes).toBe(CHANNEL_STREAM_MAX_BYTES);
    expect(cfg.max_age).toBe(CHANNEL_STREAM_MAX_AGE_NS);
    // The tier path ALWAYS set these two; the flat path never does. Their
    // absence is what proves which creator ran.
    expect("max_msg_size" in cfg).toBe(false);
    expect("num_replicas" in cfg).toBe(false);
    // Free-tier values, for contrast: 1 GiB and a 1 MiB message cap.
    expect(cfg.max_bytes).not.toBe(TENANT_TIER_LIMITS.free.max_bytes);
  });

  it("does not hand-roll the existence probe either", async () => {
    // `streams.info` was the old create-or-skip branch; the shared helper
    // decides that now (add-first, swallow STREAM_NAME_IN_USE).
    await publisher.publishMemoryProposed("tenant-no-probe", createMemory());

    expect(streamsInfo).not.toHaveBeenCalled();
  });

  it("still pre-flights JetStream capacity before the first publish", async () => {
    // The capacity guard this service owned must survive the delegation —
    // it is opt-in on the shared helper (`checkCapacity: true`).
    await publisher.publishMemoryProposed("tenant-capacity", createMemory());

    expect(getAccountInfo).toHaveBeenCalled();
  });

  it("maps a capacity shortfall to a 503 (ServiceUnavailableException)", async () => {
    // The shared helper throws JetStreamCapacityError; this service has always
    // answered 503 when JetStream had no room, and must keep doing so.
    getAccountInfo.mockImplementation(() =>
      Promise.resolve({ storage: 0, limits: { max_storage: 1 } })
    );

    await expect(
      publisher.publishMemoryProposed("tenant-no-room", createMemory())
    ).rejects.toThrow(ServiceUnavailableException);

    expect(streamsAdd).not.toHaveBeenCalled();

    getAccountInfo.mockImplementation(() =>
      Promise.resolve({ storage: 0, limits: { max_storage: 10_000_000_000 } })
    );
  });
});
