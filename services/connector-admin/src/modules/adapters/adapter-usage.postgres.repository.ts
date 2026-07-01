import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { UsageTenantConnectionManager } from "../../providers/tenant-connection-manager.usage";

export const ADAPTER_USAGE_REPOSITORY = Symbol("ADAPTER_USAGE_REPOSITORY");

export interface IAdapterUsageRow {
  readonly adapterId: string;
  readonly totalCalls: number;
  readonly successCalls: number;
  readonly errorCalls: number;
  readonly avgDurationMs: number;
  readonly cacheHits: number;
}

interface IUsageRawRow {
  adapter_id: string;
  total_calls: string | number;
  success_calls: string | number;
  error_calls: string | number;
  avg_duration_ms: string | number;
  cache_hits: string | number;
}

/**
 * Read-only repository over `connector_call_events` in the shared
 * TimescaleDB usage cluster. Injected via {@link UsageTenantConnectionManager}
 * which connects to `yoizen_usage` (separate from the adapter OLTP DB).
 *
 * All queries use positional params only — no tenant ID interpolation
 * into SQL strings.
 */
@Injectable()
export class AdapterUsagePostgresRepository {
  constructor(
    @Inject(UsageTenantConnectionManager)
    private readonly connections: TenantConnectionManager,
  ) {}

  /**
   * Returns per-adapter call statistics aggregated over a rolling window.
   *
   * @param tenantId  - Tenant scope (positional param $1).
   * @param windowDays - Window width in days (positional param $2 as integer).
   */
  async getTopByCallCount(
    tenantId: string,
    windowDays: number
  ): Promise<IAdapterUsageRow[]> {
    const sql = await this.connections.ensureSchema(tenantId);
    const rows = (await sql.unsafe(
      `
      SELECT
        adapter_id,
        COUNT(*)::int                                        AS total_calls,
        COUNT(*) FILTER (WHERE status < 400)::int            AS success_calls,
        COUNT(*) FILTER (WHERE status >= 400)::int           AS error_calls,
        COALESCE(AVG(duration_ms), 0)::int                   AS avg_duration_ms,
        COUNT(*) FILTER (WHERE LOWER(cache_result) = 'hit')::int AS cache_hits
      FROM connector_call_events
      WHERE tenant_id = $1
        AND ts >= NOW() - ($2 * INTERVAL '1 day')
      GROUP BY adapter_id
      ORDER BY total_calls DESC
    `,
      [tenantId, windowDays]
    )) as IUsageRawRow[];

    return rows.map((r) => ({
      adapterId: r.adapter_id,
      totalCalls: Number(r.total_calls),
      successCalls: Number(r.success_calls),
      errorCalls: Number(r.error_calls),
      avgDurationMs: Number(r.avg_duration_ms),
      cacheHits: Number(r.cache_hits),
    }));
  }
}
