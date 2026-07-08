import { Injectable } from "@nestjs/common";
import type { SKBQueryHistoryRecord } from "./skb-query-history.repository";
// biome-ignore lint/style/useImportType: SKBQueryHistoryRepository is constructor-injected by NestJS DI — it must be a value import so `design:paramtypes` metadata resolves the real class at runtime, not `type`.
import { SKBQueryHistoryRepository } from "./skb-query-history.repository";

export type { SKBQueryHistoryRecord };

@Injectable()
export class SKBQueryHistoryService {
  constructor(private readonly repo: SKBQueryHistoryRepository) {}

  async recordQuery(
    tenantId: string,
    containerId: string,
    nlQuery: string,
    generatedSql: string,
    resultCount: number,
    durationMs: number,
    arg7?: string | null,
    arg8?: string | null,
    arg9?: string | null,
    /**
     * Attribution ids (metering-foundation.md G5), nullable — kept as a
     * trailing options object rather than more positional params so callers
     * that pass them don't have to disambiguate against the arg7/arg8/arg9
     * userId/error/errorMessage overload resolution above.
     */
    attribution?: {
      correlationId?: string | null;
      causationId?: string | null;
      executionId?: string | null;
    }
  ): Promise<SKBQueryHistoryRecord> {
    const correlationId = attribution?.correlationId ?? null;
    const causationId = attribution?.causationId ?? null;
    const executionId = attribution?.executionId ?? null;

    // arg7 is userId when called with 7 args, error when called with 8+
    if (arg7 === undefined) {
      // No optional params
      return this.repo.recordQuery(
        tenantId,
        containerId,
        nlQuery,
        generatedSql,
        resultCount,
        durationMs,
        null,
        undefined,
        undefined,
        correlationId,
        causationId,
        executionId
      );
    }

    if (arg8 === undefined) {
      // Only arg7 provided — it's userId
      return this.repo.recordQuery(
        tenantId,
        containerId,
        nlQuery,
        generatedSql,
        resultCount,
        durationMs,
        null,
        arg7,
        undefined,
        correlationId,
        causationId,
        executionId
      );
    }

    // All optional params provided — arg7=error, arg8=userId, arg9=errorMessage
    return this.repo.recordQuery(
      tenantId,
      containerId,
      nlQuery,
      generatedSql,
      resultCount,
      durationMs,
      arg7,
      arg8,
      arg9,
      correlationId,
      causationId,
      executionId
    );
  }

  async getQueryHistory(
    tenantId: string,
    containerId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<SKBQueryHistoryRecord[]> {
    return this.repo.getHistory(tenantId, containerId, limit, offset);
  }

  async getRecentQueries(
    tenantId: string,
    containerId: string,
    hours: number = 24
  ): Promise<SKBQueryHistoryRecord[]> {
    return this.repo.getRecentQueries(tenantId, containerId, hours);
  }

  async getQueryStats(
    tenantId: string,
    containerId: string
  ): Promise<{
    total_queries: number;
    avg_duration_ms: number;
    error_rate: number;
  }> {
    return this.repo.getStats(tenantId, containerId);
  }

  async deleteQueryHistory(
    tenantId: string,
    containerId: string,
    olderThan?: Date
  ): Promise<number> {
    return this.repo.deleteOlderThan(tenantId, containerId, olderThan);
  }
}
