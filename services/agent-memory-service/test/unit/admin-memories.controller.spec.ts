import "../setup-env";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdminMemoriesController } from "../../src/modules/memory/controllers/admin-memories.controller";
import { MemoryService, type INatsPublisher } from "../../src/modules/memory/services/memory.service";
import type { IMemory } from "../../src/modules/memory/domain/memory.entity";
import { MemoryScope, MemoryKind, MemoryStatus } from "../../src/modules/memory/domain/enums";
import { NatsPublisher } from "../../src/providers/nats.provider";

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

describe("AdminMemoriesController", () => {
  let controller: AdminMemoriesController;
  let mockService: MemoryService;
  let mockNatsPublisher: INatsPublisher;

  beforeEach(async () => {
    mockService = {
      getMemories: mock(() => Promise.resolve({ items: [], total: 0 })),
      getMemory: mock(() => Promise.resolve(createMockMemory())),
      proposeMemory: mock(() => Promise.resolve(createMockMemory())),
      updateMemory: mock(() => Promise.resolve(createMockMemory())),
      approveMemory: mock(() => Promise.resolve(createMockMemory())),
      rejectMemory: mock(() => Promise.resolve(createMockMemory())),
      deleteMemory: mock(() => Promise.resolve()),
    } as any;

    mockNatsPublisher = {
      publishMemoryProposed: mock(() => Promise.resolve()),
      publishMemoryApproved: mock(() => Promise.resolve()),
      publishMemoryRejected: mock(() => Promise.resolve()),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminMemoriesController],
      providers: [
        { provide: MemoryService, useValue: mockService },
        { provide: NatsPublisher, useValue: mockNatsPublisher },
      ],
    }).compile();

    controller = moduleRef.get(AdminMemoriesController);
  });

  describe("list", () => {
    it("should return memories list", async () => {
      const memories = [createMockMemory(), createMockMemory({ id: "mem-2" })];
      (mockService.getMemories as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ items: memories, total: 2 }),
      );

      const result = await controller.list("tenant-1", {} as any);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe("getOne", () => {
    it("should return a single memory", async () => {
      const memory = createMockMemory();
      (mockService.getMemory as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(memory));

      const result = await controller.getOne("tenant-1", "mem-1");

      expect(result.id).toBe("mem-1");
    });
  });

  describe("create", () => {
    it("should create memory with dto and pass natsPublisher", async () => {
      const dto = {
        scope: MemoryScope.TENANT,
        kind: MemoryKind.NOTICE,
        title: "Admin Notice",
        content: "admin content",
        userId: "admin-user",
        sessionId: "admin-session",
        metadata: { priority: "high" },
        topicKey: "admin-topic",
        ttl: 7200,
      };

      await controller.create("tenant-1", dto as any);

      expect(mockService.proposeMemory).toHaveBeenCalledWith("tenant-1", {
        scope: dto.scope,
        kind: dto.kind,
        title: dto.title,
        content: dto.content,
        userId: dto.userId,
        sessionId: dto.sessionId,
        metadata: dto.metadata,
        topicKey: dto.topicKey,
        ttl: dto.ttl,
      }, mockNatsPublisher);
    });
  });

  describe("update", () => {
    it("should update memory with dto", async () => {
      const dto = {
        title: "Updated Title",
        content: "Updated Content",
        metadata: { updated: true },
      };

      await controller.update("tenant-1", "mem-1", dto as any);

      expect(mockService.updateMemory).toHaveBeenCalledWith("tenant-1", "mem-1", dto);
    });
  });

  describe("approve", () => {
    it("should approve memory and pass natsPublisher", async () => {
      const approved = createMockMemory({ status: MemoryStatus.ACTIVE });
      (mockService.approveMemory as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(approved));

      const result = await controller.approve("tenant-1", "mem-1");

      expect(result.status).toBe(MemoryStatus.ACTIVE);
      expect(mockService.approveMemory).toHaveBeenCalledWith("tenant-1", "mem-1", mockNatsPublisher);
    });
  });

  describe("reject", () => {
    it("should reject memory and pass natsPublisher", async () => {
      const rejected = createMockMemory({ status: MemoryStatus.REJECTED });
      (mockService.rejectMemory as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(rejected));

      const result = await controller.reject("tenant-1", "mem-1");

      expect(result.status).toBe(MemoryStatus.REJECTED);
      expect(mockService.rejectMemory).toHaveBeenCalledWith("tenant-1", "mem-1", mockNatsPublisher);
    });
  });

  describe("remove", () => {
    it("should delete memory", async () => {
      await controller.remove("tenant-1", "mem-1");

      expect(mockService.deleteMemory).toHaveBeenCalledWith("tenant-1", "mem-1");
    });
  });
});
