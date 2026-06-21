import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { ChannelAuditService } from "../../src/modules/channel-audit/channel-audit.service";
import {
  CHANNEL_AUDIT_REPOSITORY,
  type IChannelAuditRepository,
} from "../../src/modules/channel-audit/channel-audit.repository.interface";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../src/providers/nats.provider";
import type { IStoredChannelEvent } from "../../src/common/channel-audit-projection";

/** Minimal IStoredChannelEvent stub for chain tests. */
function makeChannelRow(
  overrides: Partial<IStoredChannelEvent> & { id: string },
): IStoredChannelEvent {
  return {
    id: overrides.id,
    tenantId: "tenant-a",
    channel: "telegram",
    provider: "telegram",
    kind: "received",
    accountId: "acc-1",
    fromId: null,
    toId: null,
    messageType: null,
    messageText: null,
    providerMessageId: null,
    correlationId: "corr-1",
    causationId: null,
    depth: 0,
    data: {},
    natsSubject: "ingress.telegram.tenant-a",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function* emptyStreamList(): AsyncGenerator<never> {
  return;
}

const mockJsm = {
  streams: {
    info: mock(() => Promise.resolve({})),
    add: mock(() => Promise.resolve({})),
    list: mock(() => emptyStreamList()),
  },
  consumers: {
    info: mock(() => Promise.reject(new Error("consumer not found"))),
    add: mock(() => Promise.resolve({})),
  },
};
const mockJs = {
  consumers: { get: mock(() => Promise.reject(new Error("skip"))) },
};

describe("ChannelAuditService.getChannelChain", () => {
  let service: ChannelAuditService;
  let findByCorrelationId: ReturnType<typeof mock>;

  const root = makeChannelRow({
    id: "evt-root",
    kind: "received",
    causationId: null,
    depth: 0,
    createdAt: "2026-06-20T10:00:00.000Z",
  });
  const mid = makeChannelRow({
    id: "evt-mid",
    kind: "processing",
    causationId: "evt-root",
    depth: 1,
    createdAt: "2026-06-20T10:00:01.000Z",
  });
  const leaf = makeChannelRow({
    id: "evt-leaf",
    kind: "sent",
    causationId: "evt-mid",
    depth: 2,
    createdAt: "2026-06-20T10:00:02.000Z",
  });

  beforeEach(async () => {
    findByCorrelationId = mock(() => Promise.resolve([root, mid, leaf]));

    const mockRepo: Partial<IChannelAuditRepository> = {
      insertChannelEvent: mock(() => Promise.resolve()),
      queryEvents: mock(() => Promise.resolve([])),
      getEventById: mock(() => Promise.resolve(null)),
      findByCorrelationId,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAuditService,
        { provide: CHANNEL_AUDIT_REPOSITORY, useValue: mockRepo },
        { provide: JETSTREAM_MANAGER, useValue: mockJsm },
        { provide: JETSTREAM_PUBLISHER, useValue: mockJs },
      ],
    }).compile();

    service = moduleRef.get(ChannelAuditService);
  });

  it("returns ChainTreeResult with root=received and node_count=3 for a 3-event chain", async () => {
    const result = await service.getChannelChain("corr-1", "tenant-a");

    expect(result).not.toBeNull();
    expect(result!.node_count).toBe(3);
    expect(result!.root.type).toBe("received");
    expect(result!.root.children).toHaveLength(1);
    expect(result!.root.children[0]!.children).toHaveLength(1);
    expect(result!.root.children[0]!.children[0]!.type).toBe("sent");
    expect(result!.correlation_id).toBe("corr-1");
  });

  it("returns null when no rows found (→ 404 in controller)", async () => {
    findByCorrelationId.mockImplementation(() => Promise.resolve([]));

    const result = await service.getChannelChain("corr-empty", "tenant-a");
    expect(result).toBeNull();
  });
});
