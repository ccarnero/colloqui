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
 * AND `producer: "agent-admin-service"` (the constants then named
 * `PLATFORM_DOMAIN`/`PLATFORM_PRODUCER`,
 * borrowed from agent-admin). Two different answers to "which domain is this
 * event?" and "who published it?" in the same message.
 *
 * Both were one leftover: `git log --follow` shows this file was renamed out of
 * the admin service at 61% similarity (`R061` in `e9e3a94b`), where those
 * constants were correct. The extraction rewrote the SUBJECT and
 * `transport.agent_id` (`nats.provider.ts:56`) for the new service but left the
 * envelope identity fields pointing at the old one. T08 fixed the domain half;
 * the producer half followed on 2026-07-31.
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

    it(`${kind}: envelope.producer equals the subject's producer token`, async () => {
      await publish();
      const { subject, envelope } = published();
      const tokens = subjectTokens(subject);

      expect(tokens.producer).toBe(AGENT_MEMORY_PRODUCER);
      expect(envelope["producer"]).toBe(tokens.producer);
      // The inherited value: this file was renamed out of the admin service
      // (R061 in `e9e3a94b`), which is where `agent-admin-service` came from.
      expect(envelope["producer"]).not.toBe("agent-admin-service");
    });

    it(`${kind}: envelope.type obeys the grammar and matches the subject`, async () => {
      await publish();
      const { subject, envelope } = published();
      const subjectSegments = subject.split(".");
      const typeSegments = String(envelope["type"]).split(".");

      // envelope.md:77 — io.yoizen.<domain>.<channel>.<provider>.<kind>.v1
      expect(typeSegments.length).toBe(7);
      expect(typeSegments.slice(0, 2)).toEqual(["io", "yoizen"]);
      expect(typeSegments[2]).toBe(subjectSegments[3]); // domain
      expect(typeSegments[3]).toBe(subjectSegments[4]); // channel
      expect(typeSegments[4]).toBe(subjectSegments[5]); // provider
      expect(typeSegments[5]).toBe(subjectSegments[6]); // kind
      expect(typeSegments[6]).toBe(subjectSegments[7]); // version
      expect(typeSegments[5]).toBe(kind);
      // The old form: `io.yoizen.agent-memory.memory.<verb>.v1`.
      expect(String(envelope["type"]).startsWith("io.yoizen.agent-memory.memory.")).toBe(
        false
      );
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
