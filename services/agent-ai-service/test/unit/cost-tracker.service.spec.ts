import "reflect-metadata";
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

import { Test } from "@nestjs/testing";
import { CostTrackerService } from "../../src/modules/llm/cost-tracker.service";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";
import type { ICostEvent } from "../../src/abstractions/cost-event.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid ICostEvent with sensible defaults. */
const makeEvent = (overrides: Partial<ICostEvent> = {}): ICostEvent => ({
  tenantId: "tenant-1",
  agentId: "agent-1",
  executionId: "exec-1",
  model: "gpt-4o",
  provider: "openai",
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.001,
  timestamp: new Date().toISOString(),
  ...overrides,
});

/** Today's date in YYYY-MM-DD (matches the service's `todayKey()`). */
const todayKey = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Mock Redis factory
// ---------------------------------------------------------------------------

const createMockRedis = () => {
  const pipelineOps = {
    hincrbyfloat: mock(() => pipelineOps),
    hincrby: mock(() => pipelineOps),
    expire: mock(() => pipelineOps),
    exec: mock(() => Promise.resolve([])),
  };

  return {
    pipeline: mock(() => pipelineOps),
    hgetall: mock(() => Promise.resolve({})),
    hget: mock(() => Promise.resolve(null)),
    scan: mock(() => Promise.resolve(["0", []] as [string, string[]])),
    // Expose for assertions on pipeline-level calls
    _pipelineOps: pipelineOps,
  };
};

type MockRedis = ReturnType<typeof createMockRedis>;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("CostTrackerService", () => {
  let service: CostTrackerService;
  let redis: MockRedis;
  let originalBudget: string | undefined;

  beforeEach(async () => {
    // Save and clear budget env so tests start from a clean state
    originalBudget = process.env.LLM_DAILY_BUDGET_USD;
    delete process.env.LLM_DAILY_BUDGET_USD;

    redis = createMockRedis();

    const moduleRef = await Test.createTestingModule({
      providers: [
        CostTrackerService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(CostTrackerService);
  });

  afterEach(() => {
    // Restore original env value
    if (originalBudget !== undefined) {
      process.env.LLM_DAILY_BUDGET_USD = originalBudget;
    } else {
      delete process.env.LLM_DAILY_BUDGET_USD;
    }
  });

  // =========================================================================
  //  estimateCost (static — no DI needed)
  // =========================================================================
  describe("estimateCost (static)", () => {
    it("should calculate cost for openai:gpt-4o correctly", () => {
      // inputPerMillion=2.5, outputPerMillion=10.0
      const cost = CostTrackerService.estimateCost("openai", "gpt-4o", 1_000_000, 1_000_000);
      expect(cost).toBe(12.5); // 2.5 + 10.0
    });

    it("should calculate cost for anthropic:claude-3-5-sonnet-20241022 correctly", () => {
      // inputPerMillion=3.0, outputPerMillion=15.0
      const cost = CostTrackerService.estimateCost(
        "anthropic",
        "claude-3-5-sonnet-20241022",
        500_000,
        200_000,
      );
      // 500k/1M * 3.0 = 1.5, 200k/1M * 15.0 = 3.0 → total 4.5
      expect(cost).toBe(4.5);
    });

    it("should use DEFAULT_PRICING for unknown provider:model", () => {
      // DEFAULT: inputPerMillion=1.0, outputPerMillion=4.0
      const cost = CostTrackerService.estimateCost("unknown", "model-x", 1_000_000, 1_000_000);
      expect(cost).toBe(5.0); // 1.0 + 4.0
    });

    it("should return 0 when both token counts are 0", () => {
      const cost = CostTrackerService.estimateCost("openai", "gpt-4o", 0, 0);
      expect(cost).toBe(0);
    });

    it("should return 0 when input tokens is 0 (only output cost)", () => {
      // gpt-4o output: 100/1M * 10.0 = 0.001
      const cost = CostTrackerService.estimateCost("openai", "gpt-4o", 0, 100);
      expect(cost).toBe(0.001);
    });

    it("should return 0 when output tokens is 0 (only input cost)", () => {
      // gpt-4o input: 100/1M * 2.5 = 0.00025
      const cost = CostTrackerService.estimateCost("openai", "gpt-4o", 100, 0);
      expect(cost).toBe(0.00025);
    });

    it("should handle large token counts correctly", () => {
      // gpt-4o: 10M input * 2.5 + 5M output * 10.0 = 25 + 50 = 75
      const cost = CostTrackerService.estimateCost("openai", "gpt-4o", 10_000_000, 5_000_000);
      expect(cost).toBe(75);
    });

    it("should calculate fractional costs for small token counts", () => {
      // groq:llama-3.3-70b-versatile: input=0.59, output=0.79
      // 1 token each: 1/1M * 0.59 + 1/1M * 0.79
      const cost = CostTrackerService.estimateCost("groq", "llama-3.3-70b-versatile", 1, 1);
      expect(cost).toBeCloseTo(0.00000138, 10);
    });
  });

  // =========================================================================
  //  recordCost
  // =========================================================================
  describe("recordCost", () => {
    it("should record to the correct Redis key pattern", async () => {
      const event = makeEvent({ timestamp: "2025-06-01T12:00:00.000Z" });
      await service.recordCost(event);

      // toDateKey("2025-06-01T12:00:00.000Z") → "2025-06-01"
      const expectedKey = `agent-ai:costs:tenant-1:agent-1:2025-06-01`;
      expect(redis.pipeline).toHaveBeenCalledTimes(1);
      expect(redis._pipelineOps.hincrbyfloat).toHaveBeenCalledWith(
        expectedKey,
        "costUsd",
        event.costUsd,
      );
    });

    it("should use pipeline hincrbyfloat for costUsd", async () => {
      const event = makeEvent({ costUsd: 0.042 });
      await service.recordCost(event);

      expect(redis._pipelineOps.hincrbyfloat).toHaveBeenCalledWith(
        expect.any(String),
        "costUsd",
        0.042,
      );
    });

    it("should use hincrby for tokensUsed (input + output)", async () => {
      const event = makeEvent({ inputTokens: 200, outputTokens: 100 });
      await service.recordCost(event);

      expect(redis._pipelineOps.hincrby).toHaveBeenCalledWith(
        expect.any(String),
        "tokensUsed",
        300, // 200 + 100
      );
    });

    it("should use hincrby for inputTokens", async () => {
      const event = makeEvent({ inputTokens: 750 });
      await service.recordCost(event);

      expect(redis._pipelineOps.hincrby).toHaveBeenCalledWith(
        expect.any(String),
        "inputTokens",
        750,
      );
    });

    it("should use hincrby for outputTokens", async () => {
      const event = makeEvent({ outputTokens: 320 });
      await service.recordCost(event);

      expect(redis._pipelineOps.hincrby).toHaveBeenCalledWith(
        expect.any(String),
        "outputTokens",
        320,
      );
    });

    it("should set expiry to 90 days in seconds (7 776 000)", async () => {
      const event = makeEvent();
      await service.recordCost(event);

      expect(redis._pipelineOps.expire).toHaveBeenCalledWith(
        expect.any(String),
        90 * 24 * 60 * 60, // 7 776 000
      );
    });

    it("should execute the pipeline", async () => {
      const event = makeEvent();
      await service.recordCost(event);

      expect(redis._pipelineOps.exec).toHaveBeenCalledTimes(1);
    });

    it("should return true when within budget", async () => {
      // Default budget is 50 USD, event cost is tiny → within budget
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "0.001", tokensUsed: "150" }),
      );

      const result = await service.recordCost(makeEvent({ costUsd: 0.001 }));
      expect(result).toBe(true);
    });

    it("should return false when over budget", async () => {
      // Current cost already at 49.999, adding 0.002 → 50.001 > 50
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "49.999", tokensUsed: "100000" }),
      );

      const result = await service.recordCost(makeEvent({ costUsd: 0.002 }));
      expect(result).toBe(false);
    });

    it("should still write to Redis even when over budget", async () => {
      // Ensure recording happens regardless of budget status
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "50.0", tokensUsed: "100000" }),
      );

      const result = await service.recordCost(makeEvent({ costUsd: 1.0 }));
      expect(result).toBe(false);
      // Pipeline was still called (cost is recorded even when over budget)
      expect(redis.pipeline).toHaveBeenCalledTimes(1);
      expect(redis._pipelineOps.exec).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  //  getUsage
  // =========================================================================
  describe("getUsage", () => {
    it("should read the correct Redis key", async () => {
      await service.getUsage("tenant-1", "agent-1");

      const expectedKey = `agent-ai:costs:tenant-1:agent-1:${todayKey()}`;
      expect(redis.hgetall).toHaveBeenCalledWith(expectedKey);
    });

    it("should parse costUsd from hgetall result", async () => {
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "12.345", tokensUsed: "5000" }),
      );

      const usage = await service.getUsage("t", "a");
      expect(usage.costUsd).toBe(12.345);
    });

    it("should parse tokensUsed from hgetall result", async () => {
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "1.0", tokensUsed: "9999" }),
      );

      const usage = await service.getUsage("t", "a");
      expect(usage.tokensUsed).toBe(9999);
    });

    it("should default costUsd to 0 when Redis returns empty", async () => {
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.costUsd).toBe(0);
    });

    it("should default tokensUsed to 0 when Redis returns empty", async () => {
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.tokensUsed).toBe(0);
    });

    it("should compute remaining = limitUsd - costUsd", async () => {
      process.env.LLM_DAILY_BUDGET_USD = "100";
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "30", tokensUsed: "1000" }),
      );

      const usage = await service.getUsage("t", "a");
      expect(usage.remaining).toBe(70); // 100 - 30
    });

    it("should clamp remaining to >= 0 when cost exceeds limit", async () => {
      process.env.LLM_DAILY_BUDGET_USD = "10";
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "15", tokensUsed: "1000" }),
      );

      const usage = await service.getUsage("t", "a");
      expect(usage.remaining).toBe(0); // Math.max(0, 10-15)
    });

    it("should return limitUsd from env when set", async () => {
      process.env.LLM_DAILY_BUDGET_USD = "200";
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.limitUsd).toBe(200);
    });

    it("should default limitUsd to 50 when env is not set", async () => {
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.limitUsd).toBe(50);
    });

    it("should include tenantId and agentId in the result", async () => {
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("my-tenant", "my-agent");
      expect(usage.tenantId).toBe("my-tenant");
      expect(usage.agentId).toBe("my-agent");
    });

    it("should set period to today's date key", async () => {
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.period).toBe(todayKey());
    });
  });

  // =========================================================================
  //  canProceed
  // =========================================================================
  describe("canProceed", () => {
    it("should return true when cost + estimated <= limit", async () => {
      // Budget=50, current cost=10, estimated=39.999 → 49.999 <= 50 → true
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "10", tokensUsed: "5000" }),
      );

      const result = await service.canProceed("t", "a", 39.999);
      expect(result).toBe(true);
    });

    it("should return true when cost + estimated exactly equals limit", async () => {
      // Budget=50, current cost=10, estimated=40 → 50 <= 50 → true
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "10", tokensUsed: "5000" }),
      );

      const result = await service.canProceed("t", "a", 40);
      expect(result).toBe(true);
    });

    it("should return false when cost + estimated > limit", async () => {
      // Budget=50, current cost=10, estimated=40.001 → 50.001 > 50 → false
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "10", tokensUsed: "5000" }),
      );

      const result = await service.canProceed("t", "a", 40.001);
      expect(result).toBe(false);
    });

    it("should return false when current cost already exceeds limit", async () => {
      // Budget=50, current cost=55, estimated=0 → 55 > 50 → false
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "55", tokensUsed: "10000" }),
      );

      const result = await service.canProceed("t", "a", 0);
      expect(result).toBe(false);
    });

    it("should return true with 0 cost and 0 estimated", async () => {
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const result = await service.canProceed("t", "a", 0);
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  //  getDailyCost
  // =========================================================================
  describe("getDailyCost", () => {
    it("should delegate to getUsage when agentId is provided", async () => {
      redis.hgetall.mockImplementation(() =>
        Promise.resolve({ costUsd: "7.5", tokensUsed: "3000" }),
      );

      const cost = await service.getDailyCost("tenant-1", "agent-1");
      expect(cost).toBe(7.5);
      // Should NOT call scan when agentId is provided
      expect(redis.scan).not.toHaveBeenCalled();
    });

    it("should scan pattern and sum all agent costs when agentId is omitted", async () => {
      // First scan returns two keys, cursor "0" (done)
      redis.scan.mockImplementation(() =>
        Promise.resolve([
          "0",
          [
            "agent-ai:costs:tenant-1:agent-a:2025-06-01",
            "agent-ai:costs:tenant-1:agent-b:2025-06-01",
          ],
        ]),
      );
      redis.hget.mockImplementation((_key: string, field: string) => {
        if (field !== "costUsd") return Promise.resolve(null);
        // Both return 5.0 → total = 10.0
        return Promise.resolve("5.0");
      });

      const cost = await service.getDailyCost("tenant-1");
      expect(cost).toBe(10.0);
    });

    it("should handle SCAN pagination (cursor !== '0' → loops)", async () => {
      let callCount = 0;
      redis.scan.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: return cursor "42" and one key
          return Promise.resolve([
            "42",
            ["agent-ai:costs:tenant-1:agent-a:2025-06-01"],
          ]);
        }
        // Second call: cursor "0" (done) and another key
        return Promise.resolve([
          "0",
          ["agent-ai:costs:tenant-1:agent-b:2025-06-01"],
        ]);
      });
      redis.hget.mockImplementation((_key: string, field: string) => {
        if (field !== "costUsd") return Promise.resolve(null);
        return Promise.resolve("3.0");
      });

      const cost = await service.getDailyCost("tenant-1");
      // 2 keys * 3.0 each = 6.0
      expect(cost).toBe(6.0);
      expect(redis.scan).toHaveBeenCalledTimes(2);
    });

    it("should skip keys where costUsd is null/missing", async () => {
      redis.scan.mockImplementation(() =>
        Promise.resolve([
          "0",
          [
            "agent-ai:costs:tenant-1:agent-a:2025-06-01",
            "agent-ai:costs:tenant-1:agent-b:2025-06-01",
          ],
        ]),
      );
      redis.hget.mockImplementation((redisKey: string, field: string) => {
        if (field !== "costUsd") return Promise.resolve(null);
        // Use ":agent-a:" to avoid matching the "agent-ai:" prefix in every key
        if (redisKey.includes(":agent-a:")) return Promise.resolve("10.0");
        // agent-b has no costUsd → hget returns null
        return Promise.resolve(null);
      });

      const cost = await service.getDailyCost("tenant-1");
      // Only agent-a counted: 10.0
      expect(cost).toBe(10.0);
    });

    it("should return 0 when SCAN returns no keys", async () => {
      redis.scan.mockImplementation(() =>
        Promise.resolve(["0", []]),
      );

      const cost = await service.getDailyCost("tenant-1");
      expect(cost).toBe(0);
    });

    it("should use correct SCAN pattern with tenantId and today's date", async () => {
      redis.scan.mockImplementation((_cursor: string, ...args: string[]) => {
        // Verify the MATCH pattern argument
        expect(args[0]).toBe("MATCH");
        expect(args[1]).toBe(`agent-ai:costs:tenant-42:*:${todayKey()}`);
        expect(args[2]).toBe("COUNT");
        expect(args[3]).toBe(100);
        return Promise.resolve(["0", []]);
      });

      await service.getDailyCost("tenant-42");
    });
  });

  // =========================================================================
  //  getBudgetLimit (tested indirectly via getUsage, but also direct)
  // =========================================================================
  describe("getBudgetLimit (via getUsage)", () => {
    it("should read from process.env.LLM_DAILY_BUDGET_USD when set", async () => {
      process.env.LLM_DAILY_BUDGET_USD = "123.45";
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.limitUsd).toBe(123.45);
    });

    it("should fall back to default (50) when env is not set", async () => {
      delete process.env.LLM_DAILY_BUDGET_USD;
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.limitUsd).toBe(50);
    });

    it("should fall back to default when env value is NaN", async () => {
      process.env.LLM_DAILY_BUDGET_USD = "not-a-number";
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.limitUsd).toBe(50);
    });

    it("should fall back to default when env value is 0", async () => {
      process.env.LLM_DAILY_BUDGET_USD = "0";
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.limitUsd).toBe(50);
    });

    it("should fall back to default when env value is negative", async () => {
      process.env.LLM_DAILY_BUDGET_USD = "-10";
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.limitUsd).toBe(50);
    });

    it("should fall back to default when env value is empty string", async () => {
      process.env.LLM_DAILY_BUDGET_USD = "";
      redis.hgetall.mockImplementation(() => Promise.resolve({}));

      const usage = await service.getUsage("t", "a");
      expect(usage.limitUsd).toBe(50);
    });
  });
});
