import { Injectable, Inject, Logger } from "@nestjs/common";
import Redis from "ioredis";
import type { IBudgetTracker, IBudgetUsage } from "../../abstractions/budget-tracker.interface";
import type { ICostEvent } from "../../abstractions/cost-event.interface";
import { REDIS_CLIENT } from "../../providers/redis.provider";

const COST_KEY_PREFIX = "agent-ai:costs";
const DEFAULT_DAILY_BUDGET_USD = 50;

interface ModelPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

const PRICING_TABLE: Record<string, ModelPricing> = {
  "openai:gpt-4.1": { inputPerMillion: 2.0, outputPerMillion: 8.0 },
  "openai:gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "openai:gpt-4.1-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "openai:gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "openai:gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "anthropic:claude-sonnet-4-20250514": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "anthropic:claude-3-5-sonnet-20241022": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "anthropic:claude-3-5-haiku-20241022": { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  "google:gemini-2.0-flash": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "google:gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  "google:gemini-2.5-flash": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "groq:llama-3.3-70b-versatile": { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  "mistral:mistral-large-latest": { inputPerMillion: 2.0, outputPerMillion: 6.0 },
  "mistral:mistral-small-latest": { inputPerMillion: 0.2, outputPerMillion: 0.6 },
  "cohere:command-r-plus": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "cohere:command-r": { inputPerMillion: 0.5, outputPerMillion: 1.5 },
};

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 1.0,
  outputPerMillion: 4.0,
};

@Injectable()
export class CostTrackerService implements IBudgetTracker {
  private readonly logger = new Logger(CostTrackerService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  static estimateCost(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens: number = 0,
  ): number {
    const key = `${provider}:${model}`;
    const pricing = PRICING_TABLE[key] ?? DEFAULT_PRICING;
    const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
    const uncachedInputCost =
      (uncachedInputTokens / 1_000_000) * pricing.inputPerMillion;
    // DeepSeek and other providers give ~90% discount on cached tokens
    const cachedInputCost =
      (cachedInputTokens / 1_000_000) * pricing.inputPerMillion * 0.1;
    const outputCost =
      (outputTokens / 1_000_000) * pricing.outputPerMillion;
    return uncachedInputCost + cachedInputCost + outputCost;
  }

  async recordCost(event: ICostEvent): Promise<boolean> {
    try {
      const withinBudget = await this.canProceed(
        event.tenantId,
        event.agentId,
        event.costUsd,
      );

      const date = this.toDateKey(event.timestamp);
      const key = `${COST_KEY_PREFIX}:${event.tenantId}:${event.agentId}:${date}`;

      const pipeline = this.redis.pipeline();
      pipeline.hincrbyfloat(key, "costUsd", event.costUsd);
      pipeline.hincrby(key, "tokensUsed", event.inputTokens + event.outputTokens);
      pipeline.hincrby(key, "inputTokens", event.inputTokens);
      pipeline.hincrby(key, "outputTokens", event.outputTokens);
      pipeline.hincrby(key, "cachedInputTokens", event.cachedInputTokens ?? 0);
      pipeline.expire(key, 90 * 24 * 60 * 60);
      await pipeline.exec();

      if (!withinBudget) {
        this.logger.warn(
          `Budget exceeded for tenant=${event.tenantId}, agent=${event.agentId}. ` +
            `cost=${event.costUsd.toFixed(6)} USD`,
        );
      }

      return withinBudget;
    } catch (err) {
      this.logger.warn(
        `Failed to record cost for tenant=${event.tenantId}, agent=${event.agentId}: ${(err as Error).message}`,
      );
      return true; // Allow the request to proceed even if cost tracking fails
    }
  }

  async getUsage(tenantId: string, agentId: string): Promise<IBudgetUsage> {
    try {
      const date = this.todayKey();
      const key = `${COST_KEY_PREFIX}:${tenantId}:${agentId}:${date}`;

      const data = await this.redis.hgetall(key);
      const costUsd = parseFloat(data.costUsd ?? "0");
      const tokensUsed = parseInt(data.tokensUsed ?? "0", 10);
      const limitUsd = this.getBudgetLimit();

      return {
        tenantId,
        agentId,
        period: date,
        tokensUsed,
        costUsd,
        limitUsd,
        remaining: Math.max(0, limitUsd - costUsd),
      };
    } catch (err) {
      this.logger.warn(
        `Failed to get usage for tenant=${tenantId}, agent=${agentId}: ${(err as Error).message}`,
      );
      return {
        tenantId,
        agentId,
        period: this.todayKey(),
        tokensUsed: 0,
        costUsd: 0,
        limitUsd: this.getBudgetLimit(),
        remaining: this.getBudgetLimit(),
      };
    }
  }

  async canProceed(
    tenantId: string,
    agentId: string,
    estimatedCost: number,
  ): Promise<boolean> {
    try {
      const usage = await this.getUsage(tenantId, agentId);
      return usage.costUsd + estimatedCost <= usage.limitUsd;
    } catch (err) {
      this.logger.warn(
        `Failed to check budget for tenant=${tenantId}, agent=${agentId}: ${(err as Error).message}`,
      );
      return true; // Allow requests when budget check is unavailable
    }
  }

  async getDailyCost(tenantId: string, agentId?: string): Promise<number> {
    try {
      if (agentId) {
        const usage = await this.getUsage(tenantId, agentId);
        return usage.costUsd;
      }

      const pattern = `${COST_KEY_PREFIX}:${tenantId}:*:${this.todayKey()}`;
      let total = 0;
      let cursor = "0";

      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        for (const key of keys) {
          const cost = await this.redis.hget(key, "costUsd");
          if (cost) total += parseFloat(cost);
        }
      } while (cursor !== "0");

      return total;
    } catch (err) {
      this.logger.warn(
        `Failed to get daily cost for tenant=${tenantId}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  private toDateKey(timestamp: string): string {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private getBudgetLimit(): number {
    const envLimit = process.env.LLM_DAILY_BUDGET_USD;
    if (envLimit) {
      const parsed = parseFloat(envLimit);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return DEFAULT_DAILY_BUDGET_USD;
  }
}
