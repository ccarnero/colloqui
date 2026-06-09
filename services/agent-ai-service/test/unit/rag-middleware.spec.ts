import "reflect-metadata";
import { describe, it, expect, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @yoizen/observability to avoid pulling real pino / OTEL deps.
// MemoryClientService field-initialises a Logger.
// ---------------------------------------------------------------------------
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockPinoLoggerService {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
    verbose = mock(() => {});
    fatal = mock(() => {});
  },
}));

import {
  createRagMiddleware,
  type RagMiddlewareConfig,
} from "../../src/modules/llm/rag-middleware";
import type { EmbeddingService } from "../../src/modules/llm/embedding.service";
import type {
  MemoryClientService,
  MemorySearchResult,
} from "../../src/modules/memory/memory-client.service";

// ── Fixtures ──────────────────────────────────────────────────────────────

const memoryItems = [
  {
    id: "1",
    title: "Auth Guide",
    content: "Use JWT for authentication",
    scope: "project",
    kind: "doc",
    status: "ACTIVE",
    metadata: {},
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  },
  {
    id: "2",
    title: "API Docs",
    content: "REST endpoints use /api/v1 prefix",
    scope: "project",
    kind: "doc",
    status: "ACTIVE",
    metadata: {},
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  },
];

const emptySearchResult: MemorySearchResult = { items: [], total: 0 };

function makeSearchResult(
  items: typeof memoryItems = memoryItems,
): MemorySearchResult {
  return { items, total: items.length };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("createRagMiddleware", () => {
  let mockEmbeddingService: EmbeddingService;
  let mockMemoryClient: {
    search: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    mockEmbeddingService = {} as EmbeddingService;
    mockMemoryClient = {
      search: mock(() => Promise.resolve(makeSearchResult())),
    };
  });

  // ────────────────────────────────────────────────────────────────────────
  // Structure
  // ────────────────────────────────────────────────────────────────────────

  it("should return middleware with transformParams function", () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    expect(middleware).toBeDefined();
    expect(typeof middleware.transformParams).toBe("function");
  });

  // ────────────────────────────────────────────────────────────────────────
  // enabled=false
  // ────────────────────────────────────────────────────────────────────────

  it("should return empty middleware when enabled=false", () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
      { enabled: false },
    );

    expect(middleware.transformParams).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────────
  // String prompt
  // ────────────────────────────────────────────────────────────────────────

  it("should append context to string prompt", async () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    const params = { prompt: "How do I authenticate?" };
    const result = await middleware.transformParams!({ params } as any);

    expect(result.prompt).toContain("How do I authenticate?");
    expect(result.prompt).toContain("Relevant context:");
    expect(result.prompt).toContain("[1] Auth Guide: Use JWT for authentication");
    expect(result.prompt).toContain(
      "[2] API Docs: REST endpoints use /api/v1 prefix",
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Message array prompt
  // ────────────────────────────────────────────────────────────────────────

  it("should append context to last user message in array prompt", async () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    const params = {
      prompt: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" },
        { role: "user", content: "How do I auth?" },
      ],
    };

    const result = await middleware.transformParams!({ params } as any);

    const lastUser = (result.prompt as any[]).findLast(
      (m: any) => m.role === "user",
    );
    expect(lastUser.content).toContain("How do I auth?");
    expect(lastUser.content).toContain("Relevant context:");

    // Other messages unchanged
    const system = (result.prompt as any[]).find(
      (m: any) => m.role === "system",
    );
    expect(system.content).toBe("You are helpful.");
  });

  it("should not modify non-user messages in array", async () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    const params = {
      prompt: [
        { role: "system", content: "System msg" },
        { role: "assistant", content: "Assistant msg" },
        { role: "user", content: "User question" },
      ],
    };

    const result = await middleware.transformParams!({ params } as any);
    const messages = result.prompt as any[];

    expect(messages[0].content).toBe("System msg");
    expect(messages[1].content).toBe("Assistant msg");
    expect(messages[2].content).toContain("User question");
    expect(messages[2].content).toContain("Relevant context:");
  });

  // ────────────────────────────────────────────────────────────────────────
  // No user message → params unchanged
  // ────────────────────────────────────────────────────────────────────────

  it("should return params unchanged when no user message in prompt", async () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    const params = {
      prompt: [
        { role: "system", content: "System only" },
        { role: "assistant", content: "Assistant only" },
      ],
    };

    const result = await middleware.transformParams!({ params } as any);

    expect(result).toEqual(params);
    expect(mockMemoryClient.search).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Empty search results → params unchanged
  // ────────────────────────────────────────────────────────────────────────

  it("should return params unchanged when memory search returns empty", async () => {
    mockMemoryClient.search.mockImplementationOnce(() =>
      Promise.resolve(emptySearchResult),
    );

    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    const params = { prompt: "Hello" };
    const result = await middleware.transformParams!({ params } as any);

    expect(result.prompt).toBe("Hello");
  });

  // ────────────────────────────────────────────────────────────────────────
  // Graceful degradation — search throws
  // ────────────────────────────────────────────────────────────────────────

  it("should return params unchanged when memory search throws", async () => {
    mockMemoryClient.search.mockImplementationOnce(() =>
      Promise.reject(new Error("Service unavailable")),
    );

    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    const params = { prompt: "Hello" };
    const result = await middleware.transformParams!({ params } as any);

    expect(result.prompt).toBe("Hello");
  });

  it("should not throw when memory search throws", async () => {
    mockMemoryClient.search.mockImplementationOnce(() =>
      Promise.reject(new Error("Boom")),
    );

    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    const params = { prompt: "Hello" };

    await expect(
      middleware.transformParams!({ params } as any),
    ).resolves.toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Context truncation
  // ────────────────────────────────────────────────────────────────────────

  it("should truncate context when exceeding maxContextChars", async () => {
    const longItems = [
      {
        id: "1",
        title: "Long Doc",
        content: "A".repeat(3000),
        scope: "project",
        kind: "doc",
        status: "ACTIVE",
        metadata: {},
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
      {
        id: "2",
        title: "Another",
        content: "B".repeat(3000),
        scope: "project",
        kind: "doc",
        status: "ACTIVE",
        metadata: {},
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
    ];
    mockMemoryClient.search.mockImplementationOnce(() =>
      Promise.resolve(makeSearchResult(longItems)),
    );

    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
      { maxContextChars: 100 },
    );

    const params = { prompt: "query" };
    const result = await middleware.transformParams!({ params } as any);

    // Context should be truncated and contain the truncation marker
    expect(result.prompt).toContain("[...truncated]");
    // The context portion should not exceed maxContextChars + overhead
    const contextStart = result.prompt.indexOf("Relevant context:");
    const contextSection = result.prompt.slice(contextStart);
    // Allow some overhead for the "Relevant context:\n" prefix
    expect(contextSection.length).toBeLessThan(200);
  });

  // ────────────────────────────────────────────────────────────────────────
  // topK respected
  // ────────────────────────────────────────────────────────────────────────

  it("should pass topK to memoryClient.search", async () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
      { topK: 3 },
    );

    await middleware.transformParams!({
      params: { prompt: "query" },
    } as any);

    expect(mockMemoryClient.search).toHaveBeenCalledWith(
      "default", // tenantId
      "query",
      3, // topK
    );
  });

  it("should use default topK=5 when not configured", async () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    await middleware.transformParams!({
      params: { prompt: "query" },
    } as any);

    expect(mockMemoryClient.search).toHaveBeenCalledWith(
      "default",
      "query",
      5,
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // tenantId extraction
  // ────────────────────────────────────────────────────────────────────────

  it("should use tenantId from params when available", async () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    await middleware.transformParams!({
      params: { prompt: "query", tenantId: "tenant-abc" },
    } as any);

    expect(mockMemoryClient.search).toHaveBeenCalledWith(
      "tenant-abc",
      "query",
      5,
    );
  });

  it("should default tenantId to 'default' when not in params", async () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    await middleware.transformParams!({
      params: { prompt: "query" },
    } as any);

    expect(mockMemoryClient.search).toHaveBeenCalledWith(
      "default",
      "query",
      5,
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Default config values
  // ────────────────────────────────────────────────────────────────────────

  it("should use defaults when no config provided", async () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    // Should have transformParams (enabled defaults to true)
    expect(middleware.transformParams).toBeDefined();

    // topK should default to 5
    await middleware.transformParams!({
      params: { prompt: "test" },
    } as any);

    expect(mockMemoryClient.search).toHaveBeenCalledWith(
      "default",
      "test",
      5,
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Message array with content as parts array
  // ────────────────────────────────────────────────────────────────────────

  it("should extract text from content parts array in last user message", async () => {
    const middleware = createRagMiddleware(
      mockEmbeddingService,
      mockMemoryClient as unknown as MemoryClientService,
    );

    const params = {
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "Part one" },
            { type: "text", text: "Part two" },
          ],
        },
      ],
    };

    const result = await middleware.transformParams!({ params } as any);

    expect(result.prompt).toBeDefined();
    // Should search with combined text
    expect(mockMemoryClient.search).toHaveBeenCalledWith(
      "default",
      "Part one Part two",
      5,
    );
  });
});
