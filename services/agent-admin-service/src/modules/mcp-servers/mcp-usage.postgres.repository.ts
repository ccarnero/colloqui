import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { TenantScopedPostgresRepository } from "../../providers/tenant-scoped.repository";
import type {
  IMcpUsage,
  IMcpUsageRecentCall,
  IMcpUsageRepository,
  IMcpUsageSummary,
  IRecordMcpUsageEventData,
} from "./mcp-usage.repository.interface";

interface ISummaryRow {
  total_calls: string | number;
  success_calls: string | number;
  error_calls: string | number;
  avg_duration_ms: string | number;
}

interface IRecentCallRow {
  tool_name: string;
  success: boolean;
  duration_ms: number;
  error: string | null;
  created_at: Date;
}

/**
 * Postgres-backed repository for `mcp_call_events`, in the same per-tenant
 * database as `mcp_servers` (mcp-connections.md §3 — see
 * `schema-initializer.ts` for the reasoning behind this table living here
 * rather than in the shared `connector_call_events` TimescaleDB table).
 */
@Injectable()
export class McpUsagePostgresRepository
  extends TenantScopedPostgresRepository
  implements IMcpUsageRepository
{
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantConnectionManager,
  ) {
    super(connectionManager);
  }

  /**
   * Inserts one `mcp_call_events` row, idempotent on `eventId`
   * (metering-foundation.md G4). `id` is already the table's primary key
   * (see `schema-initializer.ts`), so supplying the producer-generated
   * `eventId` explicitly — instead of letting `DEFAULT gen_random_uuid()`
   * mint one — plus `ON CONFLICT (id) DO NOTHING` is enough to make a
   * retried delivery (client-side retry, or a redelivered Temporal activity)
   * a no-op rather than a duplicate row.
   */
  async record(
    tenantId: string,
    data: IRecordMcpUsageEventData
  ): Promise<void> {
    const sql = await this.getSql(tenantId);
    await sql`
      INSERT INTO mcp_call_events (
        id, tenant_id, mcp_server_id, server_name, tool_name, success, duration_ms, error,
        correlation_id, causation_id, execution_id, created_at
      ) VALUES (
        ${data.eventId},
        ${tenantId},
        ${data.mcpServerId ?? null},
        ${data.serverName},
        ${data.toolName},
        ${data.success},
        ${data.durationMs},
        ${data.error ?? null},
        ${data.correlationId ?? null},
        ${data.causationId ?? null},
        ${data.executionId ?? null},
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async getUsage(
    tenantId: string,
    mcpServerId: string,
    windowDays: number,
    recentLimit: number
  ): Promise<IMcpUsage> {
    const sql = await this.getSql(tenantId);

    const summaryRows = (await sql`
      SELECT
        COUNT(*)::int                              AS total_calls,
        COUNT(*) FILTER (WHERE success)::int        AS success_calls,
        COUNT(*) FILTER (WHERE NOT success)::int     AS error_calls,
        COALESCE(AVG(duration_ms), 0)::int           AS avg_duration_ms
      FROM mcp_call_events
      WHERE tenant_id = ${tenantId}
        AND mcp_server_id = ${mcpServerId}
        AND created_at >= NOW() - (${windowDays} * INTERVAL '1 day')
    `) as unknown as ISummaryRow[];

    const recentRows = (await sql`
      SELECT tool_name, success, duration_ms, error, created_at
      FROM mcp_call_events
      WHERE tenant_id = ${tenantId}
        AND mcp_server_id = ${mcpServerId}
      ORDER BY created_at DESC
      LIMIT ${recentLimit}
    `) as unknown as IRecentCallRow[];

    const row = summaryRows[0];
    const summary: IMcpUsageSummary = row
      ? {
          totalCalls: Number(row.total_calls),
          successCalls: Number(row.success_calls),
          errorCalls: Number(row.error_calls),
          avgDurationMs: Number(row.avg_duration_ms),
        }
      : { totalCalls: 0, successCalls: 0, errorCalls: 0, avgDurationMs: 0 };

    const recentCalls: IMcpUsageRecentCall[] = recentRows.map((r) => ({
      toolName: r.tool_name,
      success: r.success,
      durationMs: r.duration_ms,
      error: r.error,
      createdAt: r.created_at,
    }));

    return { windowDays, summary, recentCalls };
  }
}
