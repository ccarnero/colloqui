import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { TenantConnectionManager } from "@yoizen/database";
import { TenantScopedPostgresRepository } from "../../providers/tenant-scoped.repository";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";

export interface SKBQueryHistoryRecord {
  id: string;
  tenant_id: string;
  container_id: string;
  nl_query: string;
  generated_sql: string;
  result_count: number;
  duration_ms: number;
  error: string | null;
  user_id?: string | null;
  error_message?: string | null;
  created_at: Date;
}

@Injectable()
export class SKBQueryHistoryRepository extends TenantScopedPostgresRepository {
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantConnectionManager,
  ) {
    super(connectionManager);
  }

  async recordQuery(
    tenantId: string,
    containerId: string,
    nlQuery: string,
    generatedSql: string,
    resultCount: number,
    durationMs: number,
    error: string | null,
    userId?: string | null,
    errorMessage?: string | null,
  ): Promise<SKBQueryHistoryRecord> {
    const sql = await this.getSql(tenantId);
    const id = randomUUID();

    const [result] = await sql<SKBQueryHistoryRecord[]>`
      INSERT INTO skb_query_history
        (id, tenant_id, container_id, nl_query, generated_sql, result_count, duration_ms, error, error_message, user_id, created_at)
      VALUES
        (${id}, ${tenantId}, ${containerId}, ${nlQuery}, ${generatedSql}, ${resultCount}, ${durationMs}, ${error}, ${errorMessage ?? null}, ${userId ?? null}, NOW())
      RETURNING *
    `;
    return result;
  }

  async getHistory(
    tenantId: string,
    containerId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<SKBQueryHistoryRecord[]> {
    const sql = await this.getSql(tenantId);

    return sql<SKBQueryHistoryRecord[]>`
      SELECT * FROM skb_query_history
      WHERE tenant_id = ${tenantId} AND container_id = ${containerId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async getRecentQueries(
    tenantId: string,
    containerId: string,
    hours: number = 24,
  ): Promise<SKBQueryHistoryRecord[]> {
    const sql = await this.getSql(tenantId);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    return sql<SKBQueryHistoryRecord[]>`
      SELECT * FROM skb_query_history
      WHERE tenant_id = ${tenantId}
        AND container_id = ${containerId}
        AND created_at >= ${since}
      ORDER BY created_at DESC
    `;
  }

  async getStats(
    tenantId: string,
    containerId: string,
  ): Promise<{ total_queries: number; avg_duration_ms: number; error_rate: number }> {
    const sql = await this.getSql(tenantId);

    const [result] = await sql<Array<{
      total_queries: number;
      avg_duration_ms: number;
      error_rate: number;
    }>>`
      SELECT
        COUNT(*)::int AS total_queries,
        COALESCE(AVG(duration_ms)::numeric(10,2), 0) AS avg_duration_ms,
        COALESCE(
          SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0),
          0
        )::numeric(10,4) AS error_rate
      FROM skb_query_history
      WHERE tenant_id = ${tenantId} AND container_id = ${containerId}
    `;

    return {
      total_queries: Number(result.total_queries),
      avg_duration_ms: Number(result.avg_duration_ms),
      error_rate: Number(result.error_rate),
    };
  }

  async deleteOlderThan(
    tenantId: string,
    containerId: string,
    olderThan?: Date,
  ): Promise<number> {
    const sql = await this.getSql(tenantId);

    if (olderThan) {
      const result = await sql`
        DELETE FROM skb_query_history
        WHERE tenant_id = ${tenantId}
          AND container_id = ${containerId}
          AND created_at < ${olderThan}
      `;
      return result.count ?? 0;
    }

    const result = await sql`
      DELETE FROM skb_query_history
      WHERE tenant_id = ${tenantId}
        AND container_id = ${containerId}
    `;
    return result.count ?? 0;
  }
}
