import { describe, it, expect, mock, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

// ---------------------------------------------------------------------------
// NOTE: The class-validator decorator chain issue (see below) is a pre-existing
// test environment limitation. When ANY NestJS/workspace module is loaded,
// @yoizen/shared -> paginated-query.dto.ts triggers class-validator decorator
// evaluation that fails under Bun. This affects ALL existing tests that use
// Test.createTestingModule (e.g. tool-bridge.enabled-tools.spec.ts).
//
// To work around this, we mock @yoizen/database to prevent the chain:
//   MemoryClientService -> config.ts -> @yoizen/database -> @yoizen/shared
// If this mock is insufficient, the test will fail with the same pre-existing
// error — that's expected and mirrors the existing test environment state.
// ---------------------------------------------------------------------------
mock.module("@yoizen/database", () => ({
  resolveStorageEngine: () => "memory" as const,
  StorageEngine: { Memory: "memory" },
}));

// The MemoryClientService uses globalThis.fetch for HTTP calls.
const BASE_URL = "http://memory-service:3000";

const makeMemoryItem = (overrides: Record<string, unknown> = {}) => ({
  id: "mem-1",
  title: "Test Memory",
  content: "Some content",
  scope: "SESSION",
  kind: "FACT",
  status: "ACTIVE",
  metadata: {},
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const ORIGINAL_MEMORY_URL = process.env.MEMORY_SERVICE_URL;
process.env.MEMORY_SERVICE_URL = BASE_URL;

import { MemoryClientService } from "../../src/modules/memory/memory-client.service";

describe("MemoryClientService", () => {
  let client: MemoryClientService;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    process.env.MEMORY_SERVICE_URL = BASE_URL;
  });

  afterAll(() => {
    if (ORIGINAL_MEMORY_URL) {
      process.env.MEMORY_SERVICE_URL = ORIGINAL_MEMORY_URL;
    } else {
      delete process.env.MEMORY_SERVICE_URL;
    }
  });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new MemoryClientService();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  //  create (new method, replaces save)
  // =========================================================================

  describe("create", () => {
    it("should POST to /admin/memories with correct body and headers", async () => {
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        expect(url).toBe(`${BASE_URL}/admin/memories`);
        expect(init?.method).toBe("POST");
        const headers = init?.headers as Record<string, string>;
        expect(headers["Content-Type"]).toBe("application/json");
        expect(headers["x-yoizen-tenant"]).toBe("t1");
        const body = JSON.parse(init?.body as string);
        expect(body.scope).toBe("SESSION");
        expect(body.kind).toBe("FACT");
        expect(body.title).toBe("My Memory");
        expect(body.content).toBe("My content");
        return Promise.resolve(
          new Response(JSON.stringify(makeMemoryItem()), { status: 200 }),
        );
      });

      const result = await client.create("t1", {
        scope: "SESSION",
        kind: "FACT",
        title: "My Memory",
        content: "My content",
      });

      expect(result).toBeDefined();
      expect(result.id).toBe("mem-1");
      expect(result.title).toBe("Test Memory");
    });

    it("should throw on non-ok response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("Bad Request", { status: 400 })),
      );

      await expect(
        client.create("t1", {
          scope: "SESSION",
          kind: "FACT",
          title: "X",
          content: "Y",
        }),
      ).rejects.toThrow("Memory create failed: 400");
    });

    it("should include sessionId and userId when provided", async () => {
      globalThis.fetch = mock((_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        expect(body.sessionId).toBe("sess-1");
        expect(body.userId).toBe("user-1");
        return Promise.resolve(
          new Response(JSON.stringify(makeMemoryItem()), { status: 200 }),
        );
      });

      await client.create("t1", {
        scope: "SESSION",
        kind: "FACT",
        title: "Test",
        content: "Content",
        sessionId: "sess-1",
        userId: "user-1",
      });
    });
  });

  // =========================================================================
  //  list
  // =========================================================================

  describe("list", () => {
    it("should GET /admin/memories with query params from all query fields", async () => {
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        expect(init?.method).toBe("GET");
        expect(url).toContain("/admin/memories?");
        expect(url).toContain("scope=SESSION");
        expect(url).toContain("kind=FACT");
        expect(url).toContain("status=ACTIVE");
        expect(url).toContain("search=test");
        expect(url).toContain("limit=20");
        expect(url).toContain("offset=0");
        expect(url).toContain("includeExpired=false");
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-yoizen-tenant"]).toBe("t1");
        return Promise.resolve(
          new Response(JSON.stringify({ items: [makeMemoryItem()], total: 1 }), { status: 200 }),
        );
      });

      const result = await client.list("t1", {
        scope: "SESSION",
        kind: "FACT",
        status: "ACTIVE",
        search: "test",
        limit: 20,
        offset: 0,
        includeExpired: false,
        sessionId: undefined,
        userId: undefined,
        context: undefined,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("should handle empty search gracefully", async () => {
      globalThis.fetch = mock((url: string) => {
        expect(url).toContain("/admin/memories?");
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }),
        );
      });

      const result = await client.list("t1", { search: "" });
      expect(result.items).toEqual([]);
    });

    it("should handle missing optional query fields", async () => {
      globalThis.fetch = mock((url: string) => {
        expect(url).toContain("/admin/memories?");
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }),
        );
      });

      const result = await client.list("t1", {});
      expect(result.items).toEqual([]);
    });
  });

  // =========================================================================
  //  update
  // =========================================================================

  describe("update", () => {
    it("should PATCH /admin/memories/{id} with correct body", async () => {
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        expect(url).toBe(`${BASE_URL}/admin/memories/mem-1`);
        expect(init?.method).toBe("PATCH");
        const headers = init?.headers as Record<string, string>;
        expect(headers["Content-Type"]).toBe("application/json");
        expect(headers["x-yoizen-tenant"]).toBe("t1");
        const body = JSON.parse(init?.body as string);
        expect(body.title).toBe("Updated Title");
        expect(body.content).toBe("Updated content");
        return Promise.resolve(
          new Response(JSON.stringify(makeMemoryItem({ title: "Updated Title", content: "Updated content" })), { status: 200 }),
        );
      });

      const result = await client.update("t1", "mem-1", {
        title: "Updated Title",
        content: "Updated content",
      });

      expect(result.title).toBe("Updated Title");
      expect(result.content).toBe("Updated content");
    });

    it("should throw on non-ok response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("Not Found", { status: 404 })),
      );

      await expect(
        client.update("t1", "mem-missing", { title: "New" }),
      ).rejects.toThrow("Memory update failed: 404");
    });
  });

  // =========================================================================
  //  approve / reject
  // =========================================================================

  describe("approve", () => {
    it("should PATCH /admin/memories/{id}/approve", async () => {
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        expect(url).toBe(`${BASE_URL}/admin/memories/mem-1/approve`);
        expect(init?.method).toBe("PATCH");
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-yoizen-tenant"]).toBe("t1");
        return Promise.resolve(
          new Response(JSON.stringify(makeMemoryItem({ status: "ACTIVE" })), { status: 200 }),
        );
      });

      const result = await client.approve("t1", "mem-1");
      expect(result.status).toBe("ACTIVE");
    });

    it("should throw on non-ok response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("Not Found", { status: 404 })),
      );
      await expect(client.approve("t1", "mem-missing")).rejects.toThrow("Memory approve failed: 404");
    });
  });

  describe("reject", () => {
    it("should PATCH /admin/memories/{id}/reject", async () => {
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        expect(url).toBe(`${BASE_URL}/admin/memories/mem-1/reject`);
        expect(init?.method).toBe("PATCH");
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-yoizen-tenant"]).toBe("t1");
        return Promise.resolve(
          new Response(JSON.stringify(makeMemoryItem({ status: "REJECTED" })), { status: 200 }),
        );
      });

      const result = await client.reject("t1", "mem-1");
      expect(result.status).toBe("REJECTED");
    });

    it("should throw on non-ok response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("Internal Server Error", { status: 500 })),
      );
      await expect(client.reject("t1", "mem-1")).rejects.toThrow("Memory reject failed: 500");
    });
  });

  // =========================================================================
  //  load (existing method)
  // =========================================================================

  describe("load", () => {
    it("should GET /admin/memories/{id} and return MemoryItem", async () => {
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        expect(url).toBe(`${BASE_URL}/admin/memories/mem-1`);
        expect(init?.method).toBe("GET");
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-yoizen-tenant"]).toBe("t1");
        return Promise.resolve(new Response(JSON.stringify(makeMemoryItem()), { status: 200 }));
      });

      const result = await client.load("t1", "mem-1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("mem-1");
    });

    it("should return null on 404", async () => {
      globalThis.fetch = mock(() => Promise.resolve(new Response("Not Found", { status: 404 })));
      const result = await client.load("t1", "mem-missing");
      expect(result).toBeNull();
    });

    it("should throw on 5xx", async () => {
      globalThis.fetch = mock(() => Promise.resolve(new Response("Server Error", { status: 500 })));
      await expect(client.load("t1", "mem-1")).rejects.toThrow("Memory load failed: 500");
    });
  });

  // =========================================================================
  //  delete (existing method)
  // =========================================================================

  describe("delete", () => {
    it("should DELETE /admin/memories/{id} and return void on 204", async () => {
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        expect(url).toBe(`${BASE_URL}/admin/memories/mem-1`);
        expect(init?.method).toBe("DELETE");
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-yoizen-tenant"]).toBe("t1");
        return Promise.resolve(new Response(null, { status: 204 }));
      });

      await expect(client.delete("t1", "mem-1")).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  //  search (existing method)
  // =========================================================================

  describe("search", () => {
    it("should GET /admin/memories with search params and return results", async () => {
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        expect(url).toContain("/admin/memories?");
        expect(url).toContain("search=test");
        expect(url).toContain("limit=5");
        expect(url).toContain("status=ACTIVE");
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-yoizen-tenant"]).toBe("t1");
        return Promise.resolve(new Response(JSON.stringify({ items: [makeMemoryItem()], total: 1 }), { status: 200 }));
      });

      const result = await client.search("t1", "test", 5);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  // =========================================================================
  //  Network error handling
  // =========================================================================

  describe("network errors", () => {
    it("should throw on network timeout", async () => {
      globalThis.fetch = mock(() => Promise.reject(new Error("fetch failed: network timeout")));
      await expect(client.list("t1", {})).rejects.toThrow();
    });
  });

  // =========================================================================
  //  Base URL / header propagation
  // =========================================================================

  describe("base URL and headers", () => {
    it("should send x-yoizen-tenant header on every request", async () => {
      let callCount = 0;
      globalThis.fetch = mock((_url: string, init?: RequestInit) => {
        callCount++;
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-yoizen-tenant"]).toBe("t1");
        return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
      });

      await client.list("t1", {});
      await client.create("t1", { scope: "SESSION", kind: "FACT", title: "X", content: "Y" });
      await client.load("t1", "mem-1");
      await client.update("t1", "mem-1", { title: "T" });

      expect(callCount).toBe(4);
    });

    it("should strip trailing slash from base URL", async () => {
      process.env.MEMORY_SERVICE_URL = "http://example.com/";
      const clientWithSlash = new MemoryClientService();

      globalThis.fetch = mock((url: string) => {
        expect(url).toBe("http://example.com/admin/memories?search=");
        return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
      });

      await clientWithSlash.list("t1", { search: "" });
    });

    it("should parse valid JSON response as MemoryItem", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(makeMemoryItem({ id: "mem-parse" })), { status: 200 })),
      );

      const result = await client.load("t1", "mem-parse");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("mem-parse");
      expect(typeof result!.title).toBe("string");
      expect(typeof result!.content).toBe("string");
    });
  });
});
