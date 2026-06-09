import { Injectable } from "@nestjs/common";
import { SKBQueryHistoryRepository } from "./skb-query-history.repository";
import type { SKBQueryHistoryRecord } from "./skb-query-history.repository";

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
  ): Promise<SKBQueryHistoryRecord> {
    // arg7 is userId when called with 7 args, error when called with 8+
    if (arg7 === undefined) {
      // No optional params
      return this.repo.recordQuery(
        tenantId, containerId, nlQuery, generatedSql, resultCount, durationMs,
        null, undefined, undefined,
      );
    }

    if (arg8 === undefined) {
      // Only arg7 provided — it's userId
      return this.repo.recordQuery(
        tenantId, containerId, nlQuery, generatedSql, resultCount, durationMs,
        null, arg7,
      );
    }

    // All optional params provided — arg7=error, arg8=userId, arg9=errorMessage
    return this.repo.recordQuery(
      tenantId, containerId, nlQuery, generatedSql, resultCount, durationMs,
      arg7, arg8, arg9,
    );
  }

  async getQueryHistory(
    tenantId: string,
    containerId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<SKBQueryHistoryRecord[]> {
    return this.repo.getHistory(tenantId, containerId, limit, offset);
  }

  async getRecentQueries(
    tenantId: string,
    containerId: string,
    hours: number = 24,
  ): Promise<SKBQueryHistoryRecord[]> {
    return this.repo.getRecentQueries(tenantId, containerId, hours);
  }

  async getQueryStats(
    tenantId: string,
    containerId: string,
  ): Promise<{ total_queries: number; avg_duration_ms: number; error_rate: number }> {
    return this.repo.getStats(tenantId, containerId);
  }

  async deleteQueryHistory(
    tenantId: string,
    containerId: string,
    olderThan?: Date,
  ): Promise<number> {
    return this.repo.deleteOlderThan(tenantId, containerId, olderThan);
  }
}
