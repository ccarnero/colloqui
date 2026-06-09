import "reflect-metadata";
import { describe, it, expect, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Mock the AI SDK functions to avoid real API calls.
// We control exact return values so tests are deterministic.
// ---------------------------------------------------------------------------
const mockEmbed = mock(() =>
  Promise.resolve({
    embedding: [0.1, 0.2, 0.3],
    usage: { tokens: 10 },
  }),
);

const mockEmbedMany = mock(() =>
  Promise.resolve({
    embeddings: [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ],
    usage: { tokens: 30 },
  }),
);

// Real cosine similarity implementation for deterministic test results
const mockCosineSimilarity = mock((a: number[], b: number[]) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
});

mock.module("ai", () => ({
  embed: mockEmbed,
  embedMany: mockEmbedMany,
  cosineSimilarity: mockCosineSimilarity,
}));

// Mock @ai-sdk/openai so openai.embedding() doesn't need real credentials
mock.module("@ai-sdk/openai", () => ({
  openai: {
    embedding: mock((model: string) => ({ model, _isModel: true })),
  },
}));

import {
  EmbeddingService,
  type EmbeddingResult,
  type EmbeddingSearchResult,
} from "../../src/modules/llm/embedding.service";

// ── Tests ─────────────────────────────────────────────────────────────────

describe("EmbeddingService", () => {
  let service: EmbeddingService;

  beforeEach(() => {
    service = new EmbeddingService();
    mockEmbed.mockClear();
    mockEmbedMany.mockClear();
    mockCosineSimilarity.mockClear();

    // Reset to defaults
    mockEmbed.mockImplementation(() =>
      Promise.resolve({
        embedding: [0.1, 0.2, 0.3],
        usage: { tokens: 10 },
      }),
    );
    mockEmbedMany.mockImplementation(() =>
      Promise.resolve({
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
          [0.7, 0.8, 0.9],
        ],
        usage: { tokens: 30 },
      }),
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // embedSingle
  // ────────────────────────────────────────────────────────────────────────

  describe("embedSingle", () => {
    it("should return embedding and tokens from AI SDK embed()", async () => {
      const result = await service.embedSingle("hello world");

      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(result.tokens).toBe(10);
    });

    it("should use default model text-embedding-3-small when none specified", async () => {
      await service.embedSingle("test");

      expect(mockEmbed).toHaveBeenCalledTimes(1);
      const callArg = mockEmbed.mock.calls[0][0] as any;
      // The model is created via openai.embedding(modelName)
      expect(callArg.model).toEqual({
        model: "text-embedding-3-small",
        _isModel: true,
      });
    });

    it("should use custom model when provided", async () => {
      await service.embedSingle("test", "text-embedding-3-large");

      const callArg = mockEmbed.mock.calls[0][0] as any;
      expect(callArg.model).toEqual({
        model: "text-embedding-3-large",
        _isModel: true,
      });
    });

    it("should pass value to embed() function", async () => {
      await service.embedSingle("specific text");

      const callArg = mockEmbed.mock.calls[0][0] as any;
      expect(callArg.value).toBe("specific text");
    });

    it("should return empty embedding array when AI SDK returns empty", async () => {
      mockEmbed.mockImplementationOnce(() =>
        Promise.resolve({ embedding: [], usage: { tokens: 0 } }),
      );

      const result = await service.embedSingle("empty");

      expect(result.embedding).toEqual([]);
      expect(result.tokens).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // embedBatch
  // ────────────────────────────────────────────────────────────────────────

  describe("embedBatch", () => {
    it("should return array of embeddings with tokens", async () => {
      const results = await service.embedBatch(["a", "b", "c"]);

      expect(results).toHaveLength(3);
      expect(results[0].embedding).toEqual([0.1, 0.2, 0.3]);
      expect(results[1].embedding).toEqual([0.4, 0.5, 0.6]);
      expect(results[2].embedding).toEqual([0.7, 0.8, 0.9]);
    });

    it("should preserve order — result[i] matches values[i]", async () => {
      mockEmbedMany.mockImplementationOnce(() =>
        Promise.resolve({
          embeddings: [
            [1, 0, 0], // for "first"
            [0, 1, 0], // for "second"
            [0, 0, 1], // for "third"
          ],
          usage: { tokens: 15 },
        }),
      );

      const results = await service.embedBatch(["first", "second", "third"]);

      expect(results[0].embedding).toEqual([1, 0, 0]);
      expect(results[1].embedding).toEqual([0, 1, 0]);
      expect(results[2].embedding).toEqual([0, 0, 1]);
    });

    it("should assign same token count to all results", async () => {
      const results = await service.embedBatch(["a", "b"]);

      // embedMany returns total usage; each result gets the same tokens value
      results.forEach((r) => expect(r.tokens).toBe(30));
    });

    it("should use default model when none specified", async () => {
      await service.embedBatch(["x"]);

      const callArg = mockEmbedMany.mock.calls[0][0] as any;
      expect(callArg.model).toEqual({
        model: "text-embedding-3-small",
        _isModel: true,
      });
    });

    it("should use custom model when provided", async () => {
      await service.embedBatch(["x"], "custom-model");

      const callArg = mockEmbedMany.mock.calls[0][0] as any;
      expect(callArg.model).toEqual({
        model: "custom-model",
        _isModel: true,
      });
    });

    it("should pass all values to embedMany()", async () => {
      const values = ["alpha", "beta", "gamma"];
      await service.embedBatch(values);

      const callArg = mockEmbedMany.mock.calls[0][0] as any;
      expect(callArg.values).toEqual(values);
    });

    it("should handle single-item batch", async () => {
      mockEmbedMany.mockImplementationOnce(() =>
        Promise.resolve({
          embeddings: [[0.5, 0.5]],
          usage: { tokens: 5 },
        }),
      );

      const results = await service.embedBatch(["only"]);

      expect(results).toHaveLength(1);
      expect(results[0].embedding).toEqual([0.5, 0.5]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // findSimilar
  // ────────────────────────────────────────────────────────────────────────

  describe("findSimilar", () => {
    it("should return results sorted by score descending", async () => {
      // Query: [1, 0, 0]
      // Candidate A: [0, 1, 0] → cosSim = 0
      // Candidate B: [1, 0, 0] → cosSim = 1.0 (perfect match)
      // Candidate C: [0.7, 0.7, 0] → cosSim ≈ 0.707
      mockEmbedMany.mockImplementationOnce(() =>
        Promise.resolve({
          embeddings: [
            [1, 0, 0], // query
            [0, 1, 0], // candidate A
            [1, 0, 0], // candidate B
            [0.7, 0.7, 0], // candidate C
          ],
          usage: { tokens: 40 },
        }),
      );

      const results = await service.findSimilar("query", [
        "A",
        "B",
        "C",
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].text).toBe("B"); // score ≈ 1.0
      expect(results[1].text).toBe("C"); // score ≈ 0.707
      expect(results[2].text).toBe("A"); // score ≈ 0
      // Verify descending order
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[1].score).toBeGreaterThan(results[2].score);
    });

    it("should respect topK parameter", async () => {
      mockEmbedMany.mockImplementationOnce(() =>
        Promise.resolve({
          embeddings: [
            [1, 0, 0], // query
            [0, 1, 0], // A
            [1, 0, 0], // B
            [0.7, 0.7, 0], // C
          ],
          usage: { tokens: 40 },
        }),
      );

      const results = await service.findSimilar("query", ["A", "B", "C"], {
        topK: 2,
      });

      expect(results).toHaveLength(2);
      expect(results[0].text).toBe("B");
      expect(results[1].text).toBe("C");
    });

    it("should default topK to 5 when not specified", async () => {
      const sixCandidates = ["a", "b", "c", "d", "e", "f"];
      mockEmbedMany.mockImplementationOnce(() =>
        Promise.resolve({
          embeddings: [
            [1, 0, 0], // query
            [0.9, 0.1, 0], // a
            [0.8, 0.2, 0], // b
            [0.7, 0.3, 0], // c
            [0.6, 0.4, 0], // d
            [0.5, 0.5, 0], // e
            [0.4, 0.6, 0], // f
          ],
          usage: { tokens: 70 },
        }),
      );

      const results = await service.findSimilar("query", sixCandidates);

      // Default topK=5, so only 5 of 6 candidates returned
      expect(results).toHaveLength(5);
    });

    it("should include query as first value in embedMany call", async () => {
      await service.findSimilar("my query", ["a", "b"]);

      const callArg = mockEmbedMany.mock.calls[0][0] as any;
      expect(callArg.values[0]).toBe("my query");
      expect(callArg.values).toEqual(["my query", "a", "b"]);
    });

    it("should use custom model when provided", async () => {
      await service.findSimilar("q", ["a"], { model: "custom-embed" });

      const callArg = mockEmbedMany.mock.calls[0][0] as any;
      expect(callArg.model).toEqual({
        model: "custom-embed",
        _isModel: true,
      });
    });

    it("should return empty when candidates is empty", async () => {
      mockEmbedMany.mockImplementationOnce(() =>
        Promise.resolve({
          embeddings: [[1, 0, 0]], // only query
          usage: { tokens: 5 },
        }),
      );

      const results = await service.findSimilar("query", []);

      expect(results).toHaveLength(0);
    });

    it("should return topK=1 when explicitly set", async () => {
      mockEmbedMany.mockImplementationOnce(() =>
        Promise.resolve({
          embeddings: [
            [1, 0, 0], // query
            [0, 1, 0], // A
            [1, 0, 0], // B — perfect match
          ],
          usage: { tokens: 20 },
        }),
      );

      const results = await service.findSimilar("q", ["A", "B"], { topK: 1 });

      expect(results).toHaveLength(1);
      expect(results[0].text).toBe("B");
    });

    it("should compute scores using cosine similarity", async () => {
      // Orthogonal vectors → cosine similarity = 0
      mockEmbedMany.mockImplementationOnce(() =>
        Promise.resolve({
          embeddings: [
            [1, 0], // query
            [0, 1], // candidate — orthogonal
          ],
          usage: { tokens: 10 },
        }),
      );

      const results = await service.findSimilar("q", ["orthogonal"]);

      expect(results[0].score).toBeCloseTo(0, 5);
    });
  });
});
