import "../setup-env";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AgentToolsController } from "../../src/modules/memory/controllers/agent-tools.controller";
import { MemoryService } from "../../src/modules/memory/services/memory.service";
import type { IMemory } from "../../src/modules/memory/domain/memory.entity";
import { MemoryScope, MemoryKind, MemoryStatus } from "../../src/modules/memory/domain/enums";

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

describe("AgentToolsController", () => {
  let controller: AgentToolsController;
  let mockService: MemoryService;

  beforeEach(async () => {
    mockService = {
      proposeMemory: mock(() => Promise.resolve(createMockMemory())),
      getMemories: mock(() => Promise.resolve({ items: [], total: 0 })),
      getTimeline: mock(() => Promise.resolve([])),
    } as any;

    const moduleRef = await Test.createTestingModule({
      controllers: [AgentToolsController],
      providers: [{ provide: MemoryService, useValue: mockService }],
    }).compile();

    controller = moduleRef.get(AgentToolsController);
  });

  describe("proposeMemory", () => {
    it("should call service with correct data", async () => {
      const dto = {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        title: "Test",
        content: "content",
        userId: "user-1",
        sessionId: "session-1",
        metadata: { source: "agent" },
        topicKey: "topic-1",
        ttl: 3600,
      };

      await controller.proposeMemory("tenant-1", dto as any);

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
      });
    });

    it("should call service with minimal dto", async () => {
      const dto = {
        scope: MemoryScope.USER,
        kind: MemoryKind.PREFERENCE,
        title: "Minimal",
        content: "content",
      };

      await controller.proposeMemory("tenant-1", dto as any);

      expect(mockService.proposeMemory).toHaveBeenCalledWith("tenant-1", {
        scope: dto.scope,
        kind: dto.kind,
        title: dto.title,
        content: dto.content,
        userId: undefined,
        sessionId: undefined,
        metadata: undefined,
        topicKey: undefined,
        ttl: undefined,
      });
    });
  });

  describe("getMemories", () => {
    it("should call service with query params", async () => {
      const query = {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        limit: 10,
        offset: 0,
      };

      await controller.getMemories("tenant-1", query as any);

      expect(mockService.getMemories).toHaveBeenCalledWith("tenant-1", query);
    });
  });

  describe("getTimeline", () => {
    it("should call service with timeline filters", async () => {
      const query = {
        sessionId: "session-1",
        userId: "user-1",
        limit: 20,
        offset: 0,
      };

      await controller.getTimeline("tenant-1", "mem-1", query as any);

      expect(mockService.getTimeline).toHaveBeenCalledWith("tenant-1", {
        sessionId: query.sessionId,
        userId: query.userId,
        limit: query.limit,
        offset: query.offset,
      });
    });
  });
});
