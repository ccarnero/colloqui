import "../setup-env";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import postgres from "postgres";
import { MemoryPostgresRepository } from "../../src/modules/memory/infrastructure/memory.postgres.repository";
import { MemoryScope, MemoryKind, MemoryStatus } from "../../src/modules/memory/domain/enums";
import type { ICreateMemoryData, IUpdateMemoryData } from "../../src/modules/memory/domain/memory.repository.interface";

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(255),
    session_id VARCHAR(255),
    scope VARCHAR(20) NOT NULL DEFAULT 'SESSION',
    kind VARCHAR(20) NOT NULL DEFAULT 'FACT',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    title TEXT,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    topic_key VARCHAR(255),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    search_vector TSVECTOR GENERATED ALWAYS AS (
      to_tsvector('spanish', COALESCE(title, '') || ' ' || content)
    ) STORED
  );

  CREATE INDEX IF NOT EXISTS idx_memories_tenant_id ON memories(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
  CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
  CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
  CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
  CREATE INDEX IF NOT EXISTS idx_memories_topic_key ON memories(topic_key);
  CREATE INDEX IF NOT EXISTS idx_memories_search_vector ON memories USING GIN(search_vector);
  CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
`;

interface TestContext {
  container: StartedTestContainer;
  port: number;
  host: string;
  sql: ReturnType<typeof postgres>;
  repo: MemoryPostgresRepository;
}

class MockConnectionManager {
  private sql: ReturnType<typeof postgres>;

  constructor(sql: ReturnType<typeof postgres>) {
    this.sql = sql;
  }

  async ensureSchema(_tenantId: string): Promise<ReturnType<typeof postgres>> {
    return this.sql;
  }
}

describe("MemoryPostgresRepository (Integration)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    const container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_USER: "yoizen",
        POSTGRES_PASSWORD: "yoizen-test-password",
        POSTGRES_DB: "yoizen",
      })
      .withExposedPorts(5432)
      .withStartupTimeout(90_000)
      .start();

    const port = container.getMappedPort(5432);
    const host = container.getHost();

    const sql = postgres({
      host,
      port,
      database: "yoizen",
      username: "yoizen",
      password: "yoizen-test-password",
      max: 5,
      idle_timeout: 10,
      connect_timeout: 10,
    });

    for (let i = 0; i < 30; i++) {
      try {
        await sql`SELECT 1`;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }

    await sql.unsafe(SCHEMA_SQL);

    const connectionManager = new MockConnectionManager(sql);
    const repo = new MemoryPostgresRepository(connectionManager as any);

    ctx = { container, port, host, sql, repo };
  }, 90_000);

  afterAll(async () => {
    if (ctx?.sql) await ctx.sql.end();
    if (ctx?.container) await ctx.container.stop();
  });

  describe("create", () => {
    it("should create memory and return with generated id", async () => {
      const data: ICreateMemoryData = {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "integration test memory",
        metadata: { source: "test" },
      };

      const result = await ctx.repo.create("tenant-1", data);

      expect(result.id).toBeDefined();
      expect(result.content).toBe("integration test memory");
      expect(result.status).toBe(MemoryStatus.ACTIVE);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it("should create memory with all fields", async () => {
      const data: ICreateMemoryData = {
        sessionId: "session-123",
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        title: "Full Memory",
        content: "full content",
        metadata: { key: "value" },
      };

      const result = await ctx.repo.create("tenant-1", data);

      expect(result.sessionId).toBe("session-123");
      expect(result.scope).toBe(MemoryScope.SESSION);
      expect(result.kind).toBe(MemoryKind.FACT);
      expect(result.title).toBe("Full Memory");
      expect(result.content).toBe("full content");
      expect(result.metadata).toEqual({ key: "value" });
    });

    it("should create memory with PROPOSED status", async () => {
      const data: ICreateMemoryData = {
        scope: MemoryScope.TENANT,
        kind: MemoryKind.NOTICE,
        content: "proposed memory",
        status: MemoryStatus.PROPOSED,
      };

      const result = await ctx.repo.create("tenant-1", data);

      expect(result.status).toBe(MemoryStatus.PROPOSED);
    });
  });

  describe("findById", () => {
    it("should find memory by id", async () => {
      const created = await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "findable memory",
      });

      const found = await ctx.repo.findById("tenant-1", created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.content).toBe("findable memory");
    });

    it("should return null for non-existent id", async () => {
      const found = await ctx.repo.findById("tenant-1", "00000000-0000-0000-0000-000000000000");

      expect(found).toBeNull();
    });

    it("should return null for archived memory", async () => {
      const created = await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "to be archived",
      });

      await ctx.repo.delete("tenant-1", created.id);
      const found = await ctx.repo.findById("tenant-1", created.id);

      expect(found).toBeNull();
    });

    it("should return null when tenant_id does not match", async () => {
      const created = await ctx.repo.create("tenant-a", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "tenant A memory",
      });

      const found = await ctx.repo.findById("tenant-b", created.id);

      expect(found).toBeNull();
    });
  });

  describe("findAll", () => {
    it("should return all memories for tenant", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "memory 1" });
      await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "memory 2" });

      const result = await ctx.repo.findAll("tenant-1");

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should filter by scope", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "session memory",
      });
      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.USER,
        kind: MemoryKind.FACT,
        content: "user memory",
      });

      const result = await ctx.repo.findAll("tenant-1", { scope: MemoryScope.USER });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].content).toBe("user memory");
    });

    it("should filter by kind", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "fact memory",
      });
      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.PREFERENCE,
        content: "preference memory",
      });

      const result = await ctx.repo.findAll("tenant-1", { kind: MemoryKind.FACT });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].content).toBe("fact memory");
    });

    it("should filter by status", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      const active = await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "active" });
      const toArchive = await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "archived" });
      await ctx.repo.update("tenant-1", toArchive.id, { status: MemoryStatus.ARCHIVED });

      const result = await ctx.repo.findAll("tenant-1", { status: MemoryStatus.ACTIVE });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(active.id);
    });

    it("should support pagination with limit and offset", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      for (let i = 0; i < 5; i++) {
        await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: `memory ${i}` });
      }

      const page1 = await ctx.repo.findAll("tenant-1", { limit: 2, offset: 0 });
      expect(page1.items).toHaveLength(2);

      const page2 = await ctx.repo.findAll("tenant-1", { limit: 2, offset: 2 });
      expect(page2.items).toHaveLength(2);

      const page3 = await ctx.repo.findAll("tenant-1", { limit: 2, offset: 4 });
      expect(page3.items).toHaveLength(1);
    });

    it("should default status to ACTIVE when not specified", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "active mem" });
      const toArchive = await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "archived mem" });
      await ctx.repo.update("tenant-1", toArchive.id, { status: MemoryStatus.ARCHIVED });

      const result = await ctx.repo.findAll("tenant-1");

      expect(result.items).toHaveLength(1);
      expect(result.items[0].content).toBe("active mem");
    });

    it("should only return memories for the specified tenant", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-a", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "tenant A" });
      await ctx.repo.create("tenant-b", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "tenant B" });
      await ctx.repo.create("tenant-b", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "tenant B 2" });

      const resultA = await ctx.repo.findAll("tenant-a");
      const resultB = await ctx.repo.findAll("tenant-b");

      expect(resultA.items).toHaveLength(1);
      expect(resultA.items[0].content).toBe("tenant A");
      expect(resultB.items).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("should update title", async () => {
      const created = await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "update title",
        title: "Old Title",
      });

      const updated = await ctx.repo.update("tenant-1", created.id, {
        title: "New Title",
      });

      expect(updated!.title).toBe("New Title");
    });

    it("should update content", async () => {
      const created = await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "old content" });

      const updated = await ctx.repo.update("tenant-1", created.id, {
        content: "new content",
      });

      expect(updated!.content).toBe("new content");
    });

    it("should update metadata", async () => {
      const created = await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "update meta",
        metadata: { old: true },
      });

      const updated = await ctx.repo.update("tenant-1", created.id, {
        metadata: { new: true },
      });

      expect(updated!.metadata).toEqual({ new: true });
    });

    it("should update multiple fields at once", async () => {
      const created = await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "multi update",
        title: "Original",
      });

      const updated = await ctx.repo.update("tenant-1", created.id, {
        title: "Updated",
        content: "Updated Content",
        metadata: { updated: true },
      } as IUpdateMemoryData);

      expect(updated!.title).toBe("Updated");
      expect(updated!.content).toBe("Updated Content");
      expect(updated!.metadata).toEqual({ updated: true });
    });

    it("should update status from PROPOSED to ACTIVE", async () => {
      const created = await ctx.repo.create("tenant-1", {
        scope: MemoryScope.TENANT,
        kind: MemoryKind.NOTICE,
        content: "proposed memory",
        status: MemoryStatus.PROPOSED,
      });

      const updated = await ctx.repo.update("tenant-1", created.id, {
        status: MemoryStatus.ACTIVE,
      });

      expect(updated!.status).toBe(MemoryStatus.ACTIVE);
    });

    it("should return null for non-existent memory", async () => {
      const updated = await ctx.repo.update("tenant-1", "00000000-0000-0000-0000-000000000000", {
        title: "New",
      });

      expect(updated).toBeNull();
    });

    it("should return null when trying to update archived memory", async () => {
      const created = await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "to archive" });
      await ctx.repo.delete("tenant-1", created.id);

      const updated = await ctx.repo.update("tenant-1", created.id, {
        title: "New Title",
      });

      expect(updated).toBeNull();
    });

    it("should return null when tenant_id does not match", async () => {
      const created = await ctx.repo.create("tenant-a", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "secret" });

      const updated = await ctx.repo.update("tenant-b", created.id, {
        title: "Hijacked",
      });

      expect(updated).toBeNull();
    });
  });

  describe("delete", () => {
    it("should soft delete memory by setting status to ARCHIVED", async () => {
      const created = await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "to delete" });

      const deleted = await ctx.repo.delete("tenant-1", created.id);

      expect(deleted).toBe(true);

      const found = await ctx.repo.findById("tenant-1", created.id);
      expect(found).toBeNull();
    });

    it("should return false for non-existent memory", async () => {
      const deleted = await ctx.repo.delete("tenant-1", "00000000-0000-0000-0000-000000000000");

      expect(deleted).toBe(false);
    });

    it("should return false when deleting already archived memory", async () => {
      const created = await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "already archived" });
      await ctx.repo.delete("tenant-1", created.id);

      const deletedAgain = await ctx.repo.delete("tenant-1", created.id);
      expect(deletedAgain).toBe(false);
    });

    it("should return false when tenant_id does not match", async () => {
      const created = await ctx.repo.create("tenant-a", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "protected" });

      const deleted = await ctx.repo.delete("tenant-b", created.id);

      expect(deleted).toBe(false);
    });
  });

  describe("full-text search", () => {
    it("should return memories matching search term in content", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        title: "First",
        content: "El zorro salta sobre el perro",
      });
      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        title: "Second",
        content: "Algo completamente diferente",
      });
      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        title: "Third",
        content: "Otro documento sobre zorros y perros",
      });

      const result = await ctx.repo.findAll("tenant-1", { search: "zorro" });

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.items.some((m) => m.title === "First")).toBe(true);
      expect(result.items.some((m) => m.title === "Third")).toBe(true);
    });

    it("should return memories matching search term in title", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        title: "Titulo Unico",
        content: "contenido comun aqui",
      });
      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        title: "Titulo Comun",
        content: "contenido comun aqui",
      });

      const result = await ctx.repo.findAll("tenant-1", { search: "Unico" });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe("Titulo Unico");
    });

    it("should return empty for non-matching search term", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        title: "Title",
        content: "contenido sobre gatos",
      });

      const result = await ctx.repo.findAll("tenant-1", { search: "elefante quantico" });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("should support pagination with search", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      for (let i = 0; i < 5; i++) {
        await ctx.repo.create("tenant-1", {
          scope: MemoryScope.SESSION,
          kind: MemoryKind.FACT,
          title: `Buscable ${i}`,
          content: "contenido comun buscable",
        });
      }

      const result = await ctx.repo.findAll("tenant-1", { search: "comun", limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBeGreaterThanOrEqual(5);
    });
  });

  describe("tenant isolation", () => {
    it("should isolate memories by tenant_id", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-a", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "tenant A memory" });
      await ctx.repo.create("tenant-b", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "tenant B memory" });

      const resultA = await ctx.repo.findAll("tenant-a");

      expect(resultA.items).toHaveLength(1);
      expect(resultA.items[0].content).toBe("tenant A memory");
    });

    it("should not find memory from another tenant by id", async () => {
      const tenantBMemory = await ctx.repo.create("tenant-b", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "secret" });

      const foundByA = await ctx.repo.findById("tenant-a", tenantBMemory.id);

      expect(foundByA).toBeNull();
    });
  });

  describe("userId filtering", () => {
    it("should filter by userId", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "user 1 memory",
        userId: "user-1",
      });
      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "user 2 memory",
        userId: "user-2",
      });

      const result = await ctx.repo.findAll("tenant-1", { userId: "user-1" });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].content).toBe("user 1 memory");
    });
  });

  describe("findByTopicKey", () => {
    it("should find memory by topic key without scope", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "topic memory",
        topicKey: "my-topic",
      });

      const found = await ctx.repo.findByTopicKey("tenant-1", "my-topic");

      expect(found).not.toBeNull();
      expect(found!.content).toBe("topic memory");
      expect(found!.topicKey).toBe("my-topic");
    });

    it("should find memory by topic key with scope", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "session topic",
        topicKey: "shared-topic",
      });
      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.USER,
        kind: MemoryKind.FACT,
        content: "user topic",
        topicKey: "shared-topic",
      });

      const found = await ctx.repo.findByTopicKey("tenant-1", "shared-topic", MemoryScope.USER);

      expect(found).not.toBeNull();
      expect(found!.content).toBe("user topic");
    });

    it("should return null when topic key not found", async () => {
      const found = await ctx.repo.findByTopicKey("tenant-1", "non-existent-topic");

      expect(found).toBeNull();
    });
  });

  describe("findTimeline", () => {
    it("should return all memories ordered by created_at DESC", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      const mem1 = await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "first" });
      const mem2 = await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: "second" });

      const result = await ctx.repo.findTimeline("tenant-1", {});

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(mem2.id);
      expect(result[1].id).toBe(mem1.id);
    });

    it("should filter timeline by sessionId", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "session 1",
        sessionId: "sess-1",
      });
      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "session 2",
        sessionId: "sess-2",
      });

      const result = await ctx.repo.findTimeline("tenant-1", { sessionId: "sess-1" });

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("session 1");
    });

    it("should filter timeline by userId", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "user 1",
        userId: "user-1",
      });
      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "user 2",
        userId: "user-2",
      });

      const result = await ctx.repo.findTimeline("tenant-1", { userId: "user-1" });

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("user 1");
    });

    it("should support pagination on timeline", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      for (let i = 0; i < 5; i++) {
        await ctx.repo.create("tenant-1", { scope: MemoryScope.SESSION, kind: MemoryKind.FACT, content: `memory ${i}` });
      }

      const result = await ctx.repo.findTimeline("tenant-1", { limit: 2, offset: 0 });

      expect(result).toHaveLength(2);
    });
  });

  describe("session filtering", () => {
    it("should filter by sessionId", async () => {
      await ctx.sql`TRUNCATE TABLE memories`;

      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "session 1",
        sessionId: "sess-1",
      });
      await ctx.repo.create("tenant-1", {
        scope: MemoryScope.SESSION,
        kind: MemoryKind.FACT,
        content: "session 2",
        sessionId: "sess-2",
      });

      const result = await ctx.repo.findAll("tenant-1", { sessionId: "sess-1" });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].content).toBe("session 1");
    });
  });
});
