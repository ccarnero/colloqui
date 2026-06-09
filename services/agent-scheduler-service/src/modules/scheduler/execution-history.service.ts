import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { REDIS_CLIENT } from "../../providers/redis.provider";
import type { RedisProvider } from "../../providers/redis.provider";

export interface ExecutionRecord {
  tenantId: string;
  jobId: string;
  executionId: string;
  triggeredAt: string;
  status: "triggered" | "published" | "failed";
}

@Injectable()
export class ExecutionHistoryService {
  private readonly logger = new PinoLoggerService(ExecutionHistoryService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisProvider: RedisProvider,
  ) {}

  async recordExecution(record: ExecutionRecord): Promise<void> {
    const key = `scheduler:history:${record.tenantId}:${record.jobId}:${record.triggeredAt}`;
    const ttl = 7 * 24 * 60 * 60;

    try {
      await this.redisProvider.client.setex(
        key,
        ttl,
        JSON.stringify(record),
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to record execution: ${msg}`);
    }
  }

  async getRecentExecutions(limit = 50): Promise<ExecutionRecord[]> {
    try {
      const keys: string[] = [];
      let cursor = "0";

      do {
        const [next, batch] = await this.redisProvider.client.scan(
          cursor,
          "MATCH",
          "scheduler:history:*",
          "COUNT",
          100,
        );
        cursor = next;
        keys.push(...batch);
      } while (cursor !== "0" && keys.length < limit);

      if (keys.length === 0) return [];

      const sliced = keys.slice(0, limit);
      const values = await this.redisProvider.client.mget(...sliced);

      const records: ExecutionRecord[] = [];
      for (const val of values) {
        if (val) {
          try {
            records.push(JSON.parse(val) as ExecutionRecord);
          } catch {
            // skip malformed
          }
        }
      }

      return records.sort(
        (a, b) =>
          new Date(b.triggeredAt).getTime() -
          new Date(a.triggeredAt).getTime(),
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get recent executions: ${msg}`);
      return [];
    }
  }
}
