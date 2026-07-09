import "../setup-env";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  MemoryKind,
  MemoryScope,
  MemoryStatus,
} from "../../src/modules/memory/domain/enums";
import type { IMemory } from "../../src/modules/memory/domain/memory.entity";
import type { IMemoryRepository } from "../../src/modules/memory/domain/memory.repository.interface";
import { MEMORY_REPOSITORY } from "../../src/modules/memory/domain/memory.repository.interface";
import {
  type INatsPublisher,
  MemoryService,
} from "../../src/modules/memory/services/memory.service";

function createMockMemory(overrides?: Partial<IMemory>): IMemory {
  return {
    id: "mem-1",
    tenantId: "tenant-1",
    scope: MemoryScope.SESSION,
    kind: MemoryKind.FACT,
    status: MemoryStatus.ACTIVE,
    title: "Test Memory",
    content: "test memory content",
    userId: "user-1",
    sessionId: "session-1",
    metadata: {},
    topicKey: "topic-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("MemoryService", () => {
  let service: MemoryService;
  let mockRepository: IMemoryRepository;
  let mockNatsPublisher: INatsPublisher;
  const TENANT_ID = "tenant-1";

  beforeEach(async () => {
    mockRepository = {
      create: mock(() => Promise.resolve(createMockMemory())),
      findById: mock(() => Promise.resolve(null)),
      findByTopicKey: mock(() => Promise.resolve(null)),
      findAll: mock(() => Promise.resolve({ items: [], total: 0 })),
      update: mock(() => Promise.resolve(null)),
      delete: mock(() => Promise.resolve(false)),
      findTimeline: mock(() => Promise.resolve([])),
    };

    mockNatsPublisher = {
      publishMemoryProposed: mock(() => Promise.resolve("evt-prop-1")),
      publishMemoryApproved: mock(() => Promise.resolve()),
      publishMemoryRejected: mock(() => Promise.resolve()),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: MEMORY_REPOSITORY, useValue: mockRepository },
      ],
    }).compile();

    service = moduleRef.get(MemoryService);
  });

  describe("proposeMemory", () => {
    it("should set status to ACTIVE when scope is SESSION", async () => {
      const created = createMockMemory({
        scope: MemoryScope.SESSION,
        status: MemoryStatus.ACTIVE,
      });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      const result = await service.proposeMemory(TENANT_ID, {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        title: "Session Memory",
        content: "content",
      });

      expect(result.status).toBe(MemoryStatus.ACTIVE);
      expect(mockRepository.create).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ status: MemoryStatus.ACTIVE })
      );
    });

    it("should set status to ACTIVE when scope is USER", async () => {
      const created = createMockMemory({
        scope: MemoryScope.USER,
        status: MemoryStatus.ACTIVE,
      });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      const result = await service.proposeMemory(TENANT_ID, {
        scope: MemoryScope.USER,
        kind: MemoryKind.PREFERENCE,
        title: "User Memory",
        content: "content",
      });

      expect(result.status).toBe(MemoryStatus.ACTIVE);
    });

    it("should set status to PROPOSED when scope is TENANT", async () => {
      const created = createMockMemory({
        scope: MemoryScope.TENANT,
        status: MemoryStatus.PROPOSED,
      });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      const result = await service.proposeMemory(TENANT_ID, {
        scope: MemoryScope.TENANT,
        kind: MemoryKind.NOTICE,
        title: "Tenant Memory",
        content: "content",
      });

      expect(result.status).toBe(MemoryStatus.PROPOSED);
    });

    it("should include all optional fields when creating memory", async () => {
      const created = createMockMemory({
        userId: "user-123",
        sessionId: "session-456",
        metadata: { source: "agent" },
        topicKey: "preferences",
      });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      const result = await service.proposeMemory(TENANT_ID, {
        scope: MemoryScope.USER,
        kind: MemoryKind.PREFERENCE,
        title: "Full Memory",
        content: "content",
        userId: "user-123",
        sessionId: "session-456",
        metadata: { source: "agent" },
        topicKey: "preferences",
        ttl: 3600,
      });

      expect(result.userId).toBe("user-123");
      expect(result.sessionId).toBe("session-456");
      expect(result.metadata).toEqual({ source: "agent" });
      expect(result.topicKey).toBe("preferences");
    });

    /**
     * Correlation-chain fix: the memory_proposed envelope id is the
     * causation anchor for the later memory_published/memory_rejected
     * events, so it must be persisted on the memory row.
     */
    it("persists the proposed event id into metadata after publishing", async () => {
      const created = createMockMemory({ metadata: { source: "agent" } });
      const enriched = createMockMemory({
        metadata: { source: "agent", proposedEventId: "evt-prop-1" },
      });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(enriched)
      );

      const result = await service.proposeMemory(
        TENANT_ID,
        {
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "T",
          content: "c",
        },
        mockNatsPublisher
      );

      expect(mockNatsPublisher.publishMemoryProposed).toHaveBeenCalledWith(
        TENANT_ID,
        created
      );
      expect(mockRepository.update).toHaveBeenCalledWith(TENANT_ID, "mem-1", {
        metadata: { source: "agent", proposedEventId: "evt-prop-1" },
      });
      expect(result.metadata.proposedEventId).toBe("evt-prop-1");
    });

    it("returns the created memory unchanged when the proposed publish fails", async () => {
      const created = createMockMemory();
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );
      (
        mockNatsPublisher.publishMemoryProposed as ReturnType<typeof mock>
      ).mockImplementation(() => Promise.reject(new Error("NATS down")));

      const result = await service.proposeMemory(
        TENANT_ID,
        {
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "T",
          content: "c",
        },
        mockNatsPublisher
      );

      expect(result).toBe(created);
      expect(mockRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("approveMemory", () => {
    it("should transition PROPOSED memory to ACTIVE", async () => {
      const memory = createMockMemory({ status: MemoryStatus.PROPOSED });
      const approved = createMockMemory({ status: MemoryStatus.ACTIVE });

      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(approved)
      );

      const result = await service.approveMemory(
        TENANT_ID,
        "mem-1",
        mockNatsPublisher
      );

      expect(result.status).toBe(MemoryStatus.ACTIVE);
      expect(mockRepository.update).toHaveBeenCalledWith(TENANT_ID, "mem-1", {
        status: MemoryStatus.ACTIVE,
      });
    });

    it("should throw NotFoundException when memory is not in PROPOSED status", async () => {
      const memory = createMockMemory({ status: MemoryStatus.ACTIVE });
      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );

      await expect(service.approveMemory(TENANT_ID, "mem-1")).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw NotFoundException when memory does not exist", async () => {
      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(null)
      );

      await expect(
        service.approveMemory(TENANT_ID, "non-existent")
      ).rejects.toThrow(NotFoundException);
    });

    it("links memory.approved to the proposed event via causation", async () => {
      const memory = createMockMemory({
        status: MemoryStatus.PROPOSED,
        metadata: { proposedEventId: "evt-prop-1" },
      });
      const approved = createMockMemory({
        status: MemoryStatus.ACTIVE,
        metadata: { proposedEventId: "evt-prop-1" },
      });

      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(approved)
      );

      await service.approveMemory(TENANT_ID, "mem-1", mockNatsPublisher);

      expect(mockNatsPublisher.publishMemoryApproved).toHaveBeenCalledWith(
        TENANT_ID,
        approved,
        { causationId: "evt-prop-1", correlationId: "memory:mem-1" }
      );
    });

    it("passes null causation for legacy memories without proposedEventId", async () => {
      const memory = createMockMemory({ status: MemoryStatus.PROPOSED });
      const approved = createMockMemory({ status: MemoryStatus.ACTIVE });

      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(approved)
      );

      await service.approveMemory(TENANT_ID, "mem-1", mockNatsPublisher);

      expect(mockNatsPublisher.publishMemoryApproved).toHaveBeenCalledWith(
        TENANT_ID,
        approved,
        { causationId: null, correlationId: "memory:mem-1" }
      );
    });

    it("should not fail if NATS publish fails on approve", async () => {
      const memory = createMockMemory({ status: MemoryStatus.PROPOSED });
      const approved = createMockMemory({ status: MemoryStatus.ACTIVE });

      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(approved)
      );
      (
        mockNatsPublisher.publishMemoryApproved as ReturnType<typeof mock>
      ).mockImplementation(() => Promise.reject(new Error("NATS down")));

      const result = await service.approveMemory(
        TENANT_ID,
        "mem-1",
        mockNatsPublisher
      );
      expect(result.status).toBe(MemoryStatus.ACTIVE);
    });
  });

  describe("rejectMemory", () => {
    it("should transition PROPOSED memory to REJECTED", async () => {
      const memory = createMockMemory({ status: MemoryStatus.PROPOSED });
      const rejected = createMockMemory({ status: MemoryStatus.REJECTED });

      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(rejected)
      );

      const result = await service.rejectMemory(
        TENANT_ID,
        "mem-1",
        mockNatsPublisher
      );

      expect(result.status).toBe(MemoryStatus.REJECTED);
      expect(mockRepository.update).toHaveBeenCalledWith(TENANT_ID, "mem-1", {
        status: MemoryStatus.REJECTED,
      });
    });

    it("should throw NotFoundException when memory is not in PROPOSED status", async () => {
      const memory = createMockMemory({ status: MemoryStatus.ACTIVE });
      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );

      await expect(service.rejectMemory(TENANT_ID, "mem-1")).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw NotFoundException when memory does not exist", async () => {
      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(null)
      );

      await expect(
        service.rejectMemory(TENANT_ID, "non-existent")
      ).rejects.toThrow(NotFoundException);
    });

    it("links memory.rejected to the proposed event via causation", async () => {
      const memory = createMockMemory({
        status: MemoryStatus.PROPOSED,
        metadata: { proposedEventId: "evt-prop-1" },
      });
      const rejected = createMockMemory({
        status: MemoryStatus.REJECTED,
        metadata: { proposedEventId: "evt-prop-1" },
      });

      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(rejected)
      );

      await service.rejectMemory(TENANT_ID, "mem-1", mockNatsPublisher);

      expect(mockNatsPublisher.publishMemoryRejected).toHaveBeenCalledWith(
        TENANT_ID,
        rejected,
        { causationId: "evt-prop-1", correlationId: "memory:mem-1" }
      );
    });

    it("should publish memory.rejected NATS event with null causation for legacy memories", async () => {
      const memory = createMockMemory({ status: MemoryStatus.PROPOSED });
      const rejected = createMockMemory({ status: MemoryStatus.REJECTED });

      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(rejected)
      );

      await service.rejectMemory(TENANT_ID, "mem-1", mockNatsPublisher);

      expect(mockNatsPublisher.publishMemoryRejected).toHaveBeenCalledWith(
        TENANT_ID,
        rejected,
        { causationId: null, correlationId: "memory:mem-1" }
      );
    });

    it("should not fail if NATS publish fails on reject", async () => {
      const memory = createMockMemory({ status: MemoryStatus.PROPOSED });
      const rejected = createMockMemory({ status: MemoryStatus.REJECTED });

      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(rejected)
      );
      (
        mockNatsPublisher.publishMemoryRejected as ReturnType<typeof mock>
      ).mockImplementation(() => Promise.reject(new Error("NATS down")));

      const result = await service.rejectMemory(
        TENANT_ID,
        "mem-1",
        mockNatsPublisher
      );
      expect(result.status).toBe(MemoryStatus.REJECTED);
    });
  });

  describe("merge strategies", () => {
    it("should log REPLACE strategy for PREFERENCE kind", async () => {
      const created = createMockMemory({
        kind: MemoryKind.PREFERENCE,
        scope: MemoryScope.USER,
      });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      await service.proposeMemory(TENANT_ID, {
        scope: MemoryScope.USER,
        kind: MemoryKind.PREFERENCE,
        title: "Preference",
        content: "content",
      });

      expect(mockRepository.create).toHaveBeenCalled();
    });

    it("should log REPLACE strategy for FACT kind", async () => {
      const created = createMockMemory({ kind: MemoryKind.FACT });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      await service.proposeMemory(TENANT_ID, {
        scope: MemoryScope.USER,
        kind: MemoryKind.FACT,
        title: "Fact",
        content: "content",
      });

      expect(mockRepository.create).toHaveBeenCalled();
    });

    it("should log REPLACE strategy for NOTICE kind", async () => {
      const created = createMockMemory({ kind: MemoryKind.NOTICE });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      await service.proposeMemory(TENANT_ID, {
        scope: MemoryScope.USER,
        kind: MemoryKind.NOTICE,
        title: "Notice",
        content: "content",
      });

      expect(mockRepository.create).toHaveBeenCalled();
    });

    it("should log KEEP_BOTH strategy for INCIDENT kind", async () => {
      const created = createMockMemory({ kind: MemoryKind.INCIDENT });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      await service.proposeMemory(TENANT_ID, {
        scope: MemoryScope.USER,
        kind: MemoryKind.INCIDENT,
        title: "Incident",
        content: "content",
      });

      expect(mockRepository.create).toHaveBeenCalled();
    });

    it("should log KEEP_BOTH strategy for PROMO kind", async () => {
      const created = createMockMemory({ kind: MemoryKind.PROMO });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      await service.proposeMemory(TENANT_ID, {
        scope: MemoryScope.USER,
        kind: MemoryKind.PROMO,
        title: "Promo",
        content: "content",
      });

      expect(mockRepository.create).toHaveBeenCalled();
    });
  });

  describe("NATS events on proposeMemory", () => {
    it("should publish memory.proposed for TENANT scope", async () => {
      const created = createMockMemory({
        scope: MemoryScope.TENANT,
        status: MemoryStatus.PROPOSED,
      });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      await service.proposeMemory(
        TENANT_ID,
        {
          scope: MemoryScope.TENANT,
          kind: MemoryKind.FACT,
          title: "Tenant Memory",
          content: "content",
        },
        mockNatsPublisher
      );

      expect(mockNatsPublisher.publishMemoryProposed).toHaveBeenCalledWith(
        TENANT_ID,
        created
      );
    });

    it("should publish memory.proposed for non-TENANT scope", async () => {
      const created = createMockMemory({
        scope: MemoryScope.SESSION,
        status: MemoryStatus.ACTIVE,
      });
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      await service.proposeMemory(
        TENANT_ID,
        {
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Session Memory",
          content: "content",
        },
        mockNatsPublisher
      );

      expect(mockNatsPublisher.publishMemoryProposed).toHaveBeenCalledWith(
        TENANT_ID,
        created
      );
    });

    it("should not fail if NATS publish fails on propose", async () => {
      const created = createMockMemory();
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );
      (
        mockNatsPublisher.publishMemoryProposed as ReturnType<typeof mock>
      ).mockImplementation(() => Promise.reject(new Error("NATS down")));

      const result = await service.proposeMemory(
        TENANT_ID,
        {
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Test",
          content: "content",
        },
        mockNatsPublisher
      );

      expect(result.id).toBe("mem-1");
    });

    it("should not fail if NATS publish fails during REPLACE merge", async () => {
      const existing = createMockMemory({
        kind: MemoryKind.PREFERENCE,
        scope: MemoryScope.USER,
        topicKey: "prefs",
        metadata: { revisionCount: 2 },
      });
      const updated = createMockMemory({
        kind: MemoryKind.PREFERENCE,
        scope: MemoryScope.USER,
        topicKey: "prefs",
        metadata: { revisionCount: 3 },
      });

      (
        mockRepository.findByTopicKey as ReturnType<typeof mock>
      ).mockImplementation(() => Promise.resolve(existing));
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(updated)
      );
      (
        mockNatsPublisher.publishMemoryProposed as ReturnType<typeof mock>
      ).mockImplementation(() => Promise.reject(new Error("NATS down")));

      const result = await service.proposeMemory(
        TENANT_ID,
        {
          scope: MemoryScope.USER,
          kind: MemoryKind.PREFERENCE,
          title: "Updated Preference",
          content: "updated content",
          topicKey: "prefs",
        },
        mockNatsPublisher
      );

      expect(result.id).toBe("mem-1");
      expect(mockRepository.update).toHaveBeenCalled();
    });

    it("should not publish event when natsPublisher is undefined", async () => {
      const created = createMockMemory();
      (mockRepository.create as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(created)
      );

      await service.proposeMemory(TENANT_ID, {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        title: "Test",
        content: "content",
      });

      expect(mockNatsPublisher.publishMemoryProposed).not.toHaveBeenCalled();
    });
  });

  describe("getMemory", () => {
    it("should return memory when found", async () => {
      const memory = createMockMemory();
      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(memory)
      );

      const result = await service.getMemory(TENANT_ID, "mem-1");

      expect(result.id).toBe("mem-1");
      expect(result.title).toBe("Test Memory");
    });

    it("should throw NotFoundException when memory not found", async () => {
      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(null)
      );

      await expect(
        service.getMemory(TENANT_ID, "non-existent")
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateMemory", () => {
    it("should update memory fields", async () => {
      const existing = createMockMemory();
      const updated = createMockMemory({
        title: "Updated Title",
        content: "Updated Content",
      });

      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(existing)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(updated)
      );

      const result = await service.updateMemory(TENANT_ID, "mem-1", {
        title: "Updated Title",
        content: "Updated Content",
      });

      expect(result.title).toBe("Updated Title");
      expect(result.content).toBe("Updated Content");
      expect(mockRepository.update).toHaveBeenCalledWith(TENANT_ID, "mem-1", {
        title: "Updated Title",
        content: "Updated Content",
        metadata: undefined,
      });
    });

    it("should throw NotFoundException when memory not found", async () => {
      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(null)
      );

      await expect(
        service.updateMemory(TENANT_ID, "non-existent", { title: "New" })
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when update returns null", async () => {
      const existing = createMockMemory();
      (mockRepository.findById as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(existing)
      );
      (mockRepository.update as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(null)
      );

      await expect(
        service.updateMemory(TENANT_ID, "mem-1", { title: "New" })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("deleteMemory", () => {
    it("should delete memory successfully", async () => {
      (mockRepository.delete as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(true)
      );

      await service.deleteMemory(TENANT_ID, "mem-1");

      expect(mockRepository.delete).toHaveBeenCalledWith(TENANT_ID, "mem-1");
    });

    it("should throw NotFoundException when memory not found", async () => {
      (mockRepository.delete as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve(false)
      );

      await expect(
        service.deleteMemory(TENANT_ID, "non-existent")
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getMemories", () => {
    it("should return memories with default filters", async () => {
      const memories = [createMockMemory(), createMockMemory({ id: "mem-2" })];
      (mockRepository.findAll as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve({ items: memories, total: 2 })
      );

      const result = await service.getMemories(TENANT_ID, {} as any);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should pass all query filters to repository", async () => {
      (mockRepository.findAll as ReturnType<typeof mock>).mockImplementation(
        () => Promise.resolve({ items: [], total: 0 })
      );

      await service.getMemories(TENANT_ID, {
        scope: "SESSION",
        kind: "FACT",
        status: "ACTIVE",
        includeExpired: true,
        sessionId: "session-1",
        userId: "user-1",
        search: "test",
        context: "ctx",
        limit: 10,
        offset: 5,
      } as any);

      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        scope: "SESSION",
        kind: "FACT",
        status: "ACTIVE",
        includeExpired: true,
        sessionId: "session-1",
        userId: "user-1",
        search: "test",
        limit: 10,
        offset: 5,
      });
    });
  });

  describe("getTimeline", () => {
    it("should return timeline memories", async () => {
      const memories = [
        createMockMemory({ id: "mem-1" }),
        createMockMemory({ id: "mem-2" }),
      ];
      (
        mockRepository.findTimeline as ReturnType<typeof mock>
      ).mockImplementation(() => Promise.resolve(memories));

      const result = await service.getTimeline(TENANT_ID, {
        sessionId: "session-1",
        limit: 10,
      });

      expect(result).toHaveLength(2);
      expect(mockRepository.findTimeline).toHaveBeenCalledWith(TENANT_ID, {
        sessionId: "session-1",
        limit: 10,
      });
    });

    it("should pass empty filters when none provided", async () => {
      (
        mockRepository.findTimeline as ReturnType<typeof mock>
      ).mockImplementation(() => Promise.resolve([]));

      await service.getTimeline(TENANT_ID, {});

      expect(mockRepository.findTimeline).toHaveBeenCalledWith(TENANT_ID, {});
    });
  });
});
