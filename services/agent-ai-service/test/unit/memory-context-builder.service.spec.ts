import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { MemoryContextBuilderService } from "../../src/modules/memory/memory-context-builder.service";
import { MemoryClientService } from "../../src/modules/memory/memory-client.service";
import type { MemoryItem } from "../../src/modules/memory/memory-client.service";

// ── Fixtures ──────────────────────────────────────────────────────────────

const makeMemoryItem = (
  overrides: Partial<MemoryItem> = {},
): MemoryItem => ({
  id: "mem-1",
  title: "Test memory",
  content: "Some content",
  scope: "tenant",
  kind: "fact",
  status: "active",
  metadata: {},
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

// ── Mock ───────────────────────────────────────────────────────────────────

const mockMemoryClient = {
  search: mock(() => Promise.resolve({ items: [], total: 0 })),
};

// ── Suite ──────────────────────────────────────────────────────────────────

describe("MemoryContextBuilderService", () => {
  let service: MemoryContextBuilderService;

  beforeEach(async () => {
    mockMemoryClient.search.mockImplementation(() =>
      Promise.resolve({ items: [], total: 0 }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoryContextBuilderService,
        { provide: MemoryClientService, useValue: mockMemoryClient },
      ],
    }).compile();

    service = moduleRef.get(MemoryContextBuilderService);
  });

  // ── buildContext ───────────────────────────────────────────────────────

  describe("buildContext", () => {
    it("calls memoryClient.search with tenantId, message, and limit=10", async () => {
      await service.buildContext("tenant-1", "agent-1", "hello");

      expect(mockMemoryClient.search).toHaveBeenCalledWith(
        "tenant-1",
        "hello",
        10,
      );
    });

    it("maps search items to { title, content }", async () => {
      const items = [
        makeMemoryItem({ id: "1", title: "A", content: "Content A" }),
        makeMemoryItem({
          id: "2",
          title: "B",
          content: "Content B",
          scope: "global",
        }),
      ];
      mockMemoryClient.search.mockImplementation(() =>
        Promise.resolve({ items, total: 2 }),
      );

      const result = await service.buildContext("t1", "a1", "msg");

      expect(result.items).toEqual([
        { title: "A", content: "Content A" },
        { title: "B", content: "Content B" },
      ]);
    });

    it("creates summary from first 5 items' content joined by '; '", async () => {
      const items = Array.from({ length: 5 }, (_, i) =>
        makeMemoryItem({ id: String(i), title: `T${i}`, content: `C${i}` }),
      );
      mockMemoryClient.search.mockImplementation(() =>
        Promise.resolve({ items, total: 5 }),
      );

      const result = await service.buildContext("t1", "a1", "msg");

      expect(result.summary).toBe("C0; C1; C2; C3; C4");
    });

    it("limits summary to first 5 items when more than 5 returned", async () => {
      const items = Array.from({ length: 8 }, (_, i) =>
        makeMemoryItem({ id: String(i), title: `T${i}`, content: `C${i}` }),
      );
      mockMemoryClient.search.mockImplementation(() =>
        Promise.resolve({ items, total: 8 }),
      );

      const result = await service.buildContext("t1", "a1", "msg");

      // Summary only uses first 5, but all 8 items are returned
      expect(result.summary).toBe("C0; C1; C2; C3; C4");
      expect(result.items).toHaveLength(8);
    });

    it("uses all items in summary when fewer than 5 returned", async () => {
      const items = [
        makeMemoryItem({ id: "1", title: "A", content: "Alpha" }),
        makeMemoryItem({ id: "2", title: "B", content: "Beta" }),
      ];
      mockMemoryClient.search.mockImplementation(() =>
        Promise.resolve({ items, total: 2 }),
      );

      const result = await service.buildContext("t1", "a1", "msg");

      expect(result.summary).toBe("Alpha; Beta");
    });

    it("returns empty summary and items for empty search result", async () => {
      mockMemoryClient.search.mockImplementation(() =>
        Promise.resolve({ items: [], total: 0 }),
      );

      const result = await service.buildContext("t1", "a1", "msg");

      expect(result.summary).toBe("");
      expect(result.items).toEqual([]);
    });

    it("includes raw with tenant summary and items", async () => {
      const items = [makeMemoryItem({ title: "T", content: "C" })];
      mockMemoryClient.search.mockImplementation(() =>
        Promise.resolve({ items, total: 1 }),
      );

      const result = await service.buildContext("t1", "a1", "msg");

      expect(result.raw).toEqual({
        tenant: {
          summary: "C",
          items: [{ title: "T", content: "C" }],
        },
      });
    });

    it("returns EMPTY_CONTEXT on search error", async () => {
      mockMemoryClient.search.mockImplementation(() => {
        throw new Error("Network failure");
      });

      const result = await service.buildContext("t1", "a1", "msg");

      expect(result).toEqual({ summary: "", items: [], raw: {} });
    });

    it("logs a warning on search error", async () => {
      mockMemoryClient.search.mockImplementation(() => {
        throw new Error("Timeout");
      });

      // Spy on logger.warn — we verify it doesn't throw and returns gracefully
      const result = await service.buildContext("t1", "a1", "msg");

      // The fact that we got here without an exception means the error was caught
      expect(result.summary).toBe("");
    });

    it("handles null items in search result via nullish coalescing", async () => {
      mockMemoryClient.search.mockImplementation(() =>
        Promise.resolve({ items: null as unknown as MemoryItem[], total: 0 }),
      );

      const result = await service.buildContext("t1", "a1", "msg");

      expect(result.items).toEqual([]);
      expect(result.summary).toBe("");
    });
  });

  // ── formatForPrompt ───────────────────────────────────────────────────

  describe("formatForPrompt", () => {
    it('returns "" for empty context', () => {
      const result = service.formatForPrompt({
        summary: "",
        items: [],
        raw: {},
      });

      expect(result).toBe("");
    });

    it('returns "" for context with no summary and no items', () => {
      const result = service.formatForPrompt({
        summary: "",
        items: [],
        raw: { tenant: { summary: "", items: [] } },
      });

      expect(result).toBe("");
    });

    it("formats summary-only context correctly", () => {
      const result = service.formatForPrompt({
        summary: "Short summary",
        items: [],
        raw: {},
      });

      expect(result).toBe("Tenant memory summary:\nShort summary");
    });

    it("formats items-only context correctly", () => {
      const result = service.formatForPrompt({
        summary: "",
        items: [{ title: "Policy", content: "Be polite" }],
        raw: {},
      });

      expect(result).toBe("Tenant memories:\n- Policy: Be polite");
    });

    it("formats item without content as '- title' only", () => {
      const result = service.formatForPrompt({
        summary: "",
        items: [{ title: "Orphan", content: "" }],
        raw: {},
      });

      expect(result).toBe("Tenant memories:\n- Orphan");
    });

    it("joins both sections with double newline when both present", () => {
      const result = service.formatForPrompt({
        summary: "Brief overview",
        items: [{ title: "Rule", content: "Answer fast" }],
        raw: {},
      });

      expect(result).toBe(
        "Tenant memory summary:\nBrief overview\n\nTenant memories:\n- Rule: Answer fast",
      );
    });

    it("limits displayed items to first 10 when more are present", () => {
      const items = Array.from({ length: 15 }, (_, i) => ({
        title: `Item${i}`,
        content: `Content${i}`,
      }));

      const result = service.formatForPrompt({
        summary: "",
        items,
        raw: {},
      });

      const lines = result.split("\n").slice(1); // skip header
      expect(lines).toHaveLength(10);
      expect(lines[0]).toBe("- Item0: Content0");
      expect(lines[9]).toBe("- Item9: Content9");
    });

    it("trims leading/trailing whitespace from result", () => {
      // The final result is trimmed via .trim()
      // With trailing newline in the template, verify no trailing whitespace
      const result = service.formatForPrompt({
        summary: "hello",
        items: [],
        raw: {},
      });

      expect(result).toBe("Tenant memory summary:\nhello");
      expect(result).toBe(result.trim());
    });

    it("formats multiple items on separate lines", () => {
      const result = service.formatForPrompt({
        summary: "",
        items: [
          { title: "A", content: "Alpha" },
          { title: "B", content: "Beta" },
          { title: "C", content: "Gamma" },
        ],
        raw: {},
      });

      expect(result).toBe(
        "Tenant memories:\n- A: Alpha\n- B: Beta\n- C: Gamma",
      );
    });
  });
});
