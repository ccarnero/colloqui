import "../setup-env";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  MemoryKind,
  MemoryScope,
  MemoryStatus,
} from "../../src/modules/memory/domain/enums";
import type { IMemory } from "../../src/modules/memory/domain/memory.entity";
import { NatsPublisher } from "../../src/providers/nats.provider";

/**
 * Regression tests for the correlation-chain fix: memory_published /
 * memory_rejected envelopes must point causation_id at the
 * memory_proposed event (DOCS/messaging/envelope.md §6) instead of the
 * former hardcoded null, and publishMemoryProposed must return the
 * generated envelope id so the service layer can persist it.
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

describe("NatsPublisher causal chain", () => {
  const publishMock = mock(() => Promise.resolve({ seq: 1 }));
  // Fake LazyNatsConnection: the stream already exists so
  // ensureTenantStream takes the info() fast path and publishEvent goes
  // straight to jetstream().publish.
  const fakeLazyNats = {
    jetstreamManager: () =>
      Promise.resolve({
        streams: {
          info: () => Promise.resolve({}),
          add: () => Promise.resolve({}),
          // T03: the capacity pre-flight sums reserved bytes via streams.list.
          list: () => ({
            async *[Symbol.asyncIterator]() {},
          }),
        },
        getAccountInfo: () =>
          Promise.resolve({
            storage: 0,
            limits: { max_storage: 10_000_000_000 },
          }),
      }),
    jetstream: () => Promise.resolve({ publish: publishMock }),
    close: () => Promise.resolve(),
  };

  let publisher: NatsPublisher;

  beforeEach(() => {
    publishMock.mockClear();
    publisher = new NatsPublisher(
      fakeLazyNats as unknown as ConstructorParameters<typeof NatsPublisher>[0]
    );
  });

  function publishedEnvelope(): Record<string, any> {
    expect(publishMock).toHaveBeenCalledTimes(1);
    return JSON.parse(publishMock.mock.calls[0][1] as string);
  }

  it("publishMemoryProposed returns the published envelope id", async () => {
    const eventId = await publisher.publishMemoryProposed(
      "tenant-1",
      createMemory()
    );

    const envelope = publishedEnvelope();
    expect(typeof eventId).toBe("string");
    expect(eventId).toBe(envelope.id);
    expect(envelope.correlation_id).toBe("memory:mem-1");
    expect(envelope.causation_id).toBeNull();
  });

  it("publishMemoryApproved links causation to the proposed event", async () => {
    await publisher.publishMemoryApproved("tenant-1", createMemory(), {
      causationId: "evt-prop-1",
      correlationId: "memory:mem-1",
    });

    const envelope = publishedEnvelope();
    expect(envelope.causation_id).toBe("evt-prop-1");
    expect(envelope.correlation_id).toBe("memory:mem-1");
    expect(envelope.transport.depth).toBe(1);
  });

  it("publishMemoryApproved stays a root (null causation, depth 0) without causal context", async () => {
    await publisher.publishMemoryApproved("tenant-1", createMemory());

    const envelope = publishedEnvelope();
    expect(envelope.causation_id).toBeNull();
    expect(envelope.correlation_id).toBe("memory:mem-1");
    expect(envelope.transport.depth).toBe(0);
  });

  it("publishMemoryRejected links causation to the proposed event", async () => {
    await publisher.publishMemoryRejected("tenant-1", createMemory(), {
      causationId: "evt-prop-1",
      correlationId: "memory:mem-1",
    });

    const envelope = publishedEnvelope();
    expect(envelope.causation_id).toBe("evt-prop-1");
    expect(envelope.correlation_id).toBe("memory:mem-1");
    expect(envelope.transport.depth).toBe(1);
  });
});
