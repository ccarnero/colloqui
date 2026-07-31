import "../setup-env";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { AGENT_MEMORY_DOMAIN, AGENT_MEMORY_PRODUCER } from "@yoizen/shared";
import {
  MemoryKind,
  MemoryScope,
  MemoryStatus,
} from "../../src/modules/memory/domain/enums";
import type { IMemory } from "../../src/modules/memory/domain/memory.entity";
import { NatsPublisher } from "../../src/providers/nats.provider";

/**
 * envelope-drift T08 (finding 6) — the envelope must agree with its subject.
 *
 * The subject grammar is the spec (`AGENTS.md:64-65`):
 *   evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>
 *
 * agent-memory publishes on `...agent-memory-service.agent-memory.platform.
 * internal...` while the envelope body used to report `domain: "automation"`
 * (`PLATFORM_DOMAIN`, borrowed from agent-admin). Two different answers to
 * "which domain is this event?" in the same message.
 *
 * Nothing classified on the envelope field — `tracking-ingester`'s rule 9
 * reads the SUBJECT and says so explicitly (`classify.ts:252-253`) — but the
 * ingester DOES persist `envelope.domain` verbatim into the descriptive
 * `domain` column (`to-tracked-event-row.ts:402`), so the lie was landing in
 * the store. Rows written before this change keep `automation`.
 *
 * These tests derive the expectation from the subject the publisher actually
 * used, so they cannot drift with the constants.
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

/** Canonical subject tokens: evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<n> */
function subjectTokens(subject: string): {
  producer: string;
  domain: string;
  channel: string;
  provider: string;
} {
  const parts = subject.split(".");
  return {
    producer: parts[2]!,
    domain: parts[3]!,
    channel: parts[4]!,
    provider: parts[5]!,
  };
}

describe("NatsPublisher subject/envelope agreement", () => {
  const publishMock = mock(() => Promise.resolve({ seq: 1 }));
  const fakeLazyNats = {
    jetstreamManager: () =>
      Promise.resolve({ streams: { info: () => Promise.resolve({}) } }),
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

  function published(): { subject: string; envelope: Record<string, unknown> } {
    expect(publishMock).toHaveBeenCalledTimes(1);
    const call = publishMock.mock.calls[0] as unknown as [string, string];
    return {
      subject: call[0],
      envelope: JSON.parse(call[1]) as Record<string, unknown>,
    };
  }

  const publishers: ReadonlyArray<[string, () => Promise<unknown>]> = [
    [
      "memory_proposed",
      () => publisher.publishMemoryProposed("tenant-1", createMemory()),
    ],
    [
      "memory_published",
      () => publisher.publishMemoryApproved("tenant-1", createMemory()),
    ],
    [
      "memory_rejected",
      () => publisher.publishMemoryRejected("tenant-1", createMemory()),
    ],
    [
      "memory_expired",
      () => publisher.publishMemoryExpired("tenant-1", createMemory().id),
    ],
  ];

  for (const [kind, publish] of publishers) {
    it(`${kind}: envelope.domain equals the subject's domain token`, async () => {
      await publish();
      const { subject, envelope } = published();
      const tokens = subjectTokens(subject);

      expect(tokens.domain).toBe(AGENT_MEMORY_DOMAIN);
      expect(envelope["domain"]).toBe(tokens.domain);
      // The value it used to carry, borrowed from agent-admin's PLATFORM_DOMAIN.
      expect(envelope["domain"]).not.toBe("automation");
    });

    it(`${kind}: envelope channel/provider also match their subject tokens`, async () => {
      await publish();
      const { subject, envelope } = published();
      const tokens = subjectTokens(subject);

      expect(envelope["channel"]).toBe(tokens.channel);
      expect(envelope["provider"]).toBe(tokens.provider);
    });
  }

  it("publishes on the agent-memory subject family", async () => {
    await publisher.publishMemoryProposed("tenant-1", createMemory());
    const { subject } = published();

    expect(subject.startsWith("evt.tenant-1.")).toBe(true);
    expect(subjectTokens(subject).producer).toBe(AGENT_MEMORY_PRODUCER);
    expect(subjectTokens(subject).domain).toBe(AGENT_MEMORY_DOMAIN);
  });
});
