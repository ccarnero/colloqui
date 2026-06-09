import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  mock,
} from "bun:test";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { ValidationPipe, NotFoundException, BadRequestException } from "@nestjs/common";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { AgentToolsController } from "../../src/modules/memory/controllers/agent-tools.controller";
import { AdminMemoriesController } from "../../src/modules/memory/controllers/admin-memories.controller";
import { MemoryService } from "../../src/modules/memory/services/memory.service";
import { MemoryScope, MemoryKind } from "../../src/modules/memory/dto/propose-memory.dto";
import { MemoryStatus } from "../../src/modules/memory/domain/enums";
import type { IMemory } from "../../src/modules/memory/domain/memory.entity";
import { TenantGuard } from "@yoizen/database";
import { NatsPublisher } from "../../src/providers/nats.provider";

const TENANT_HEADER = "x-yoizen-tenant";

function createMockMemory(overrides?: Partial<IMemory>): IMemory {
  return {
    id: "mem-" + Math.random().toString(36).slice(2, 10),
    tenantId: "tenant-1",
    scope: MemoryScope.SESSION,
    kind: MemoryKind.FACT,
    status: MemoryStatus.ACTIVE,
    title: "Test Memory",
    content: "test content",
    userId: "user-1",
    sessionId: "session-1",
    metadata: {},
    topicKey: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Memory Service E2E Tests", () => {
  let app: INestApplication;
  let capturedMemories: IMemory[];
  let mockNatsPublisher: any;

  beforeAll(async () => {
    capturedMemories = [];

    mockNatsPublisher = {
      publishMemoryProposed: mock(() => Promise.resolve()),
      publishMemoryApproved: mock(() => Promise.resolve()),
      publishMemoryRejected: mock(() => Promise.resolve()),
    };

    const mockMemoryService = {
      proposeMemory: mock((tenantId: string, data: any, natsPublisher?: any) => {
        const memory = createMockMemory({
          tenantId,
          scope: data.scope,
          kind: data.kind,
          title: data.title,
          content: data.content,
          userId: data.userId,
          sessionId: data.sessionId,
          metadata: data.metadata,
          topicKey: data.topicKey,
          status: data.scope === MemoryScope.TENANT ? MemoryStatus.PROPOSED : MemoryStatus.ACTIVE,
        });
        capturedMemories.push(memory);
        return Promise.resolve(memory);
      }),

      getMemories: mock((tenantId: string, query: any) => {
        let filtered = capturedMemories.filter((m) => m.tenantId === tenantId);

        if (query.scope) filtered = filtered.filter((m) => m.scope === query.scope);
        if (query.kind) filtered = filtered.filter((m) => m.kind === query.kind);
        if (query.status) filtered = filtered.filter((m) => m.status === query.status);
        if (query.sessionId) filtered = filtered.filter((m) => m.sessionId === query.sessionId);
        if (query.userId) filtered = filtered.filter((m) => m.userId === query.userId);

        const limit = query.limit ?? 20;
        const offset = query.offset ?? 0;
        const paginated = filtered.slice(offset, offset + limit);

        return Promise.resolve({ items: paginated, total: filtered.length });
      }),

      getMemory: mock((tenantId: string, id: string) => {
        const memory = capturedMemories.find((m) => m.tenantId === tenantId && m.id === id);
        if (!memory) {
          return Promise.reject(new NotFoundException(`Memory ${id} not found`));
        }
        return Promise.resolve(memory);
      }),

      updateMemory: mock((tenantId: string, id: string, dto: any) => {
        const index = capturedMemories.findIndex((m) => m.tenantId === tenantId && m.id === id);
        if (index === -1) {
          return Promise.reject(new NotFoundException(`Memory ${id} not found`));
        }
        const updated = { ...capturedMemories[index], ...dto, updatedAt: new Date() };
        capturedMemories[index] = updated;
        return Promise.resolve(updated);
      }),

      deleteMemory: mock((tenantId: string, id: string) => {
        const index = capturedMemories.findIndex((m) => m.tenantId === tenantId && m.id === id);
        if (index === -1) {
          return Promise.reject(new NotFoundException(`Memory ${id} not found`));
        }
        capturedMemories.splice(index, 1);
        return Promise.resolve();
      }),

      approveMemory: mock((tenantId: string, id: string, natsPublisher?: any) => {
        const index = capturedMemories.findIndex((m) => m.tenantId === tenantId && m.id === id);
        if (index === -1) {
          return Promise.reject(new NotFoundException(`Memory ${id} not found`));
        }
        const memory = capturedMemories[index];
        if (memory.status !== MemoryStatus.PROPOSED) {
          return Promise.reject(new NotFoundException(`Memory ${id} is not in PROPOSED status (current: ${memory.status})`));
        }
        const approved = { ...memory, status: MemoryStatus.ACTIVE, updatedAt: new Date() };
        capturedMemories[index] = approved;
        return Promise.resolve(approved);
      }),

      rejectMemory: mock((tenantId: string, id: string, natsPublisher?: any) => {
        const index = capturedMemories.findIndex((m) => m.tenantId === tenantId && m.id === id);
        if (index === -1) {
          return Promise.reject(new NotFoundException(`Memory ${id} not found`));
        }
        const memory = capturedMemories[index];
        if (memory.status !== MemoryStatus.PROPOSED) {
          return Promise.reject(new NotFoundException(`Memory ${id} is not in PROPOSED status (current: ${memory.status})`));
        }
        const rejected = { ...memory, status: MemoryStatus.REJECTED, updatedAt: new Date() };
        capturedMemories[index] = rejected;
        return Promise.resolve(rejected);
      }),

      getTimeline: mock((tenantId: string, filters: any) => {
        let filtered = capturedMemories.filter((m) => m.tenantId === tenantId);
        if (filters.sessionId) {
          filtered = filtered.filter((m) => m.sessionId === filters.sessionId);
        }
        if (filters.userId) {
          filtered = filtered.filter((m) => m.userId === filters.userId);
        }
        filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const limit = filters.limit ?? 20;
        const offset = filters.offset ?? 0;
        return Promise.resolve(filtered.slice(offset, offset + limit));
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AgentToolsController, AdminMemoriesController],
      providers: [
        { provide: MemoryService, useValue: mockMemoryService },
        { provide: NatsPublisher, useValue: mockNatsPublisher },
        TenantGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    capturedMemories.length = 0;
  });

  describe("POST /tools/propose-memory", () => {
    it("should create memory with 201", async () => {
      const response = await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Agent Memory",
          content: "This is agent memory content",
        })
        .expect(201);

      expect(response.body.title).toBe("Agent Memory");
      expect(response.body.status).toBe(MemoryStatus.ACTIVE);
    });

    it("should create TENANT scoped memory as PROPOSED", async () => {
      const response = await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.TENANT,
          kind: MemoryKind.NOTICE,
          title: "Tenant Notice",
          content: "This needs approval",
        })
        .expect(201);

      expect(response.body.status).toBe(MemoryStatus.PROPOSED);
    });

    it("should return 400 for missing tenant header", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Test",
          content: "content",
        })
        .expect(400);
    });

    it("should return 400 for invalid DTO - missing required fields", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
        })
        .expect(400);
    });

    it("should return 400 for invalid scope enum", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: "INVALID_SCOPE",
          kind: MemoryKind.FACT,
          title: "Test",
          content: "content",
        })
        .expect(400);
    });

    it("should return 400 for invalid kind enum", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: "INVALID_KIND",
          title: "Test",
          content: "content",
        })
        .expect(400);
    });

    it("should return 400 for title exceeding max length", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "x".repeat(501),
          content: "content",
        })
        .expect(400);
    });

    it("should return 400 for content exceeding max length", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Test",
          content: "x".repeat(50_001),
        })
        .expect(400);
    });

    it("should accept memory with optional fields", async () => {
      const response = await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.USER,
          kind: MemoryKind.PREFERENCE,
          title: "User Preference",
          content: "pref content",
          userId: "user-123",
          sessionId: "session-456",
          metadata: { source: "agent" },
          topicKey: "prefs",
          ttl: 3600,
        })
        .expect(201);

      expect(response.body.userId).toBe("user-123");
      expect(response.body.sessionId).toBe("session-456");
      expect(response.body.topicKey).toBe("prefs");
    });

    it("should return 400 for invalid tenant ID format", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "in")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Test",
          content: "content",
        })
        .expect(400);
    });
  });

  describe("GET /tools/memories", () => {
    it("should list memories with 200", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Memory 1",
          content: "content 1",
        });

      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.USER,
          kind: MemoryKind.PREFERENCE,
          title: "Memory 2",
          content: "content 2",
        });

      const response = await request(app.getHttpServer())
        .get("/tools/memories")
        .set(TENANT_HEADER, "tenant-1")
        .expect(200);

      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.items.length).toBe(2);
      expect(response.body.total).toBe(2);
    });

    it("should support pagination query params", async () => {
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post("/tools/propose-memory")
          .set(TENANT_HEADER, "tenant-1")
          .send({
            scope: MemoryScope.SESSION,
            kind: MemoryKind.FACT,
            title: `Memory ${i}`,
            content: `content ${i}`,
          });
      }

      const response = await request(app.getHttpServer())
        .get("/tools/memories?limit=2&offset=0")
        .set(TENANT_HEADER, "tenant-1")
        .expect(200);

      expect(response.body.items).toHaveLength(2);
    });

    it("should filter by scope", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Session Mem",
          content: "content",
        });

      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.USER,
          kind: MemoryKind.FACT,
          title: "User Mem",
          content: "content",
        });

      const response = await request(app.getHttpServer())
        .get("/tools/memories?scope=SESSION")
        .set(TENANT_HEADER, "tenant-1")
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].title).toBe("Session Mem");
    });

    it("should return 400 for invalid scope filter", async () => {
      await request(app.getHttpServer())
        .get("/tools/memories?scope=INVALID")
        .set(TENANT_HEADER, "tenant-1")
        .expect(400);
    });

    it("should return 400 for missing tenant header", async () => {
      await request(app.getHttpServer())
        .get("/tools/memories")
        .expect(400);
    });
  });

  describe("GET /tools/memories/:id/timeline", () => {
    it("should return timeline with 200", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Timeline Mem",
          content: "content",
          sessionId: "sess-1",
        });

      const response = await request(app.getHttpServer())
        .get("/tools/memories/any-id/timeline?sessionId=sess-1")
        .set(TENANT_HEADER, "tenant-1")
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it("should return empty timeline when no matching memories", async () => {
      const response = await request(app.getHttpServer())
        .get("/tools/memories/any-id/timeline?sessionId=non-existent")
        .set(TENANT_HEADER, "tenant-1")
        .expect(200);

      expect(response.body).toHaveLength(0);
    });

    it("should return 400 for missing tenant header", async () => {
      await request(app.getHttpServer())
        .get("/tools/memories/any-id/timeline")
        .expect(400);
    });
  });

  describe("GET /admin/memories", () => {
    it("should list memories with pagination (200)", async () => {
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post("/tools/propose-memory")
          .set(TENANT_HEADER, "tenant-1")
          .send({
            scope: MemoryScope.SESSION,
            kind: MemoryKind.FACT,
            title: `Admin Mem ${i}`,
            content: `content ${i}`,
          });
      }

      const response = await request(app.getHttpServer())
        .get("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .expect(200);

      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.total).toBe(3);
    });

    it("should return 400 for missing tenant header", async () => {
      await request(app.getHttpServer())
        .get("/admin/memories")
        .expect(400);
    });
  });

  describe("POST /admin/memories", () => {
    it("should create memory with 201", async () => {
      const response = await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.TENANT,
          kind: MemoryKind.FACT,
          title: "Admin Created",
          content: "admin content",
        })
        .expect(201);

      expect(response.body.title).toBe("Admin Created");
    });

    it("should reject incomplete DTO with 400", async () => {
      await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.TENANT,
        })
        .expect(400);
    });
  });

  describe("GET /admin/memories/:id", () => {
    it("should get memory by id (200)", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Get Me",
          content: "content",
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/admin/memories/${createRes.body.id}`)
        .set(TENANT_HEADER, "tenant-1")
        .expect(200);

      expect(response.body.id).toBe(createRes.body.id);
      expect(response.body.title).toBe("Get Me");
    });

    it("should return 404 for non-existent memory", async () => {
      await request(app.getHttpServer())
        .get("/admin/memories/non-existent-id")
        .set(TENANT_HEADER, "tenant-1")
        .expect(404);
    });
  });

  describe("PATCH /admin/memories/:id", () => {
    it("should update memory (200)", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Original",
          content: "original content",
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/admin/memories/${createRes.body.id}`)
        .set(TENANT_HEADER, "tenant-1")
        .send({
          title: "Updated Title",
          content: "updated content",
        })
        .expect(200);

      expect(response.body.title).toBe("Updated Title");
      expect(response.body.content).toBe("updated content");
    });

    it("should return 404 for non-existent memory", async () => {
      await request(app.getHttpServer())
        .patch("/admin/memories/non-existent-id")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          title: "New Title",
        })
        .expect(404);
    });

    it("should return 400 for invalid update DTO", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Test",
          content: "content",
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/admin/memories/${createRes.body.id}`)
        .set(TENANT_HEADER, "tenant-1")
        .send({
          title: "x".repeat(501),
        })
        .expect(400);
    });
  });

  describe("PATCH /admin/memories/:id/approve", () => {
    it("should approve proposed memory (200)", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.TENANT,
          kind: MemoryKind.NOTICE,
          title: "To Approve",
          content: "approve me",
        })
        .expect(201);

      expect(createRes.body.status).toBe(MemoryStatus.PROPOSED);

      const response = await request(app.getHttpServer())
        .patch(`/admin/memories/${createRes.body.id}/approve`)
        .set(TENANT_HEADER, "tenant-1")
        .expect(200);

      expect(response.body.status).toBe(MemoryStatus.ACTIVE);
    });

    it("should return 404 when memory not found", async () => {
      await request(app.getHttpServer())
        .patch("/admin/memories/non-existent-id/approve")
        .set(TENANT_HEADER, "tenant-1")
        .expect(404);
    });

    it("should return 404 when memory is already active", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Already Active",
          content: "content",
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/admin/memories/${createRes.body.id}/approve`)
        .set(TENANT_HEADER, "tenant-1")
        .expect(404);
    });
  });

  describe("PATCH /admin/memories/:id/reject", () => {
    it("should reject proposed memory (200)", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.TENANT,
          kind: MemoryKind.NOTICE,
          title: "To Reject",
          content: "reject me",
        })
        .expect(201);

      expect(createRes.body.status).toBe(MemoryStatus.PROPOSED);

      const response = await request(app.getHttpServer())
        .patch(`/admin/memories/${createRes.body.id}/reject`)
        .set(TENANT_HEADER, "tenant-1")
        .expect(200);

      expect(response.body.status).toBe(MemoryStatus.REJECTED);
    });

    it("should return 404 when memory not found", async () => {
      await request(app.getHttpServer())
        .patch("/admin/memories/non-existent-id/reject")
        .set(TENANT_HEADER, "tenant-1")
        .expect(404);
    });

    it("should return 404 when memory is already active", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Already Active",
          content: "content",
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/admin/memories/${createRes.body.id}/reject`)
        .set(TENANT_HEADER, "tenant-1")
        .expect(404);
    });
  });

  describe("DELETE /admin/memories/:id", () => {
    it("should delete memory (204)", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-1")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "To Delete",
          content: "delete me",
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/admin/memories/${createRes.body.id}`)
        .set(TENANT_HEADER, "tenant-1")
        .expect(204);

      await request(app.getHttpServer())
        .get(`/admin/memories/${createRes.body.id}`)
        .set(TENANT_HEADER, "tenant-1")
        .expect(404);
    });

    it("should return 404 for non-existent memory", async () => {
      await request(app.getHttpServer())
        .delete("/admin/memories/non-existent-id")
        .set(TENANT_HEADER, "tenant-1")
        .expect(404);
    });
  });

  describe("tenant isolation", () => {
    it("should not return memories from other tenants", async () => {
      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-a")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Tenant A Memory",
          content: "content",
        });

      await request(app.getHttpServer())
        .post("/tools/propose-memory")
        .set(TENANT_HEADER, "tenant-b")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Tenant B Memory",
          content: "content",
        });

      const responseA = await request(app.getHttpServer())
        .get("/tools/memories")
        .set(TENANT_HEADER, "tenant-a")
        .expect(200);

      expect(responseA.body.items).toHaveLength(1);
      expect(responseA.body.items[0].title).toBe("Tenant A Memory");
    });

    it("should return 404 when accessing memory from another tenant", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/admin/memories")
        .set(TENANT_HEADER, "tenant-a")
        .send({
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: "Secret",
          content: "content",
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/admin/memories/${createRes.body.id}`)
        .set(TENANT_HEADER, "tenant-b")
        .expect(404);
    });
  });
});
