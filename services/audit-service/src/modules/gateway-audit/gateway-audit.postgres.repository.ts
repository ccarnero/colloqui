import { Inject, Injectable } from "@nestjs/common";
import type { Sql, TenantConnectionManager } from "@yoizen/database";
import type {
  AuditDashboardStats,
  DashboardActivity,
  GatewayAuditEvent,
} from "@yoizen/shared";
import {
  GATEWAY_AUDIT_SELECT_PROJECTION,
  mapGatewayAuditSqlRow,
  type IStoredGatewayAuditEvent,
} from "../../common/gateway-audit-projection";
import {
  ensurePostgresTenantNamespaceOnce,
} from "../../common/ensure-tenant-schema.postgres";
import { AuditTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IGatewayAuditQueryParams,
  IGatewayAuditRepository,
} from "./gateway-audit.repository.interface";

interface IAggregateRow {
  requests_today: string;
  requests_yesterday: string;
  error_count_today: string;
  error_count_yesterday: string;
  avg_response_ms: string | null;
  avg_response_ms_yesterday: string | null;
  p95_response_ms: string | null;
  active_sessions: string;
}

interface IDailyRow {
  day: string;
  requests: string;
  avg_latency_ms: string | null;
}

interface IRecentRow {
  method: string;
  path: string;
  status_code: number;
  created_at: string;
}

@Injectable()
export class GatewayAuditPostgresRepository implements IGatewayAuditRepository {
  constructor(
    @Inject(AuditTenantConnectionManager)
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  private async ensureGatewayAuditTable(tenantId: string): Promise<void> {
    await ensurePostgresTenantNamespaceOnce(
      this.tenantConnections,
      tenantId,
      "gateway_audit",
      async (s) => {
        await s`
          CREATE TABLE IF NOT EXISTS gateway_audit_events (
            request_id        TEXT        PRIMARY KEY,
            trace_id          TEXT        NOT NULL DEFAULT '',
            tenant_id         TEXT,
            method            TEXT        NOT NULL,
            path              TEXT        NOT NULL,
            status_code       INTEGER     NOT NULL,
            duration_ms       REAL        NOT NULL,
            client_ip         TEXT        NOT NULL DEFAULT '',
            user_agent        TEXT        NOT NULL DEFAULT '',
            jwt_subject       TEXT,
            route_type        TEXT        NOT NULL,
            upstream_url      TEXT,
            upstream_status   INTEGER,
            upstream_duration REAL,
            rate_limit_applied BOOLEAN    NOT NULL DEFAULT false,
            rate_limit_remaining INTEGER,
            error             TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `;
        await s`CREATE INDEX IF NOT EXISTS idx_gw_audit_created ON gateway_audit_events (created_at DESC)`;
        await s`CREATE INDEX IF NOT EXISTS idx_gw_audit_method ON gateway_audit_events (method, created_at DESC)`;
        await s`CREATE INDEX IF NOT EXISTS idx_gw_audit_route_type ON gateway_audit_events (route_type, created_at DESC)`;
        await s`CREATE INDEX IF NOT EXISTS idx_gw_audit_trace ON gateway_audit_events (trace_id)`;
      },
    );
  }

  async insertGatewayEvent(
    tenantId: string,
    event: GatewayAuditEvent,
  ): Promise<void> {
    await this.ensureGatewayAuditTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    await sql`
      INSERT INTO gateway_audit_events (
        request_id, trace_id, tenant_id, method, path,
        status_code, duration_ms, client_ip, user_agent, jwt_subject,
        route_type, upstream_url, upstream_status, upstream_duration,
        rate_limit_applied, rate_limit_remaining, error, created_at
      ) VALUES (
        ${event.requestId},
        ${event.traceId},
        ${event.tenantId},
        ${event.method},
        ${event.path},
        ${event.statusCode},
        ${event.durationMs},
        ${event.clientIp},
        ${event.userAgent},
        ${event.jwtSubject},
        ${event.routeType},
        ${event.upstream?.url ?? null},
        ${event.upstream?.statusCode ?? null},
        ${event.upstream?.durationMs ?? null},
        ${event.rateLimitApplied},
        ${event.rateLimitRemaining ?? null},
        ${event.error ?? null},
        ${event.timestamp}
      )
      ON CONFLICT (request_id) DO NOTHING
    `;
  }

  async queryEvents(
    params: IGatewayAuditQueryParams,
    tenantId: string,
  ): Promise<IStoredGatewayAuditEvent[]> {
    const { method, routeType, from, to, limit, offset } = params;
    await this.ensureGatewayAuditTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const rows = await sql<Parameters<typeof mapGatewayAuditSqlRow>[0][]>`
      SELECT ${sql.unsafe(GATEWAY_AUDIT_SELECT_PROJECTION)}
      FROM gateway_audit_events
      WHERE 1=1
        ${method ? sql`AND method = ${method}` : sql``}
        ${routeType ? sql`AND route_type = ${routeType}` : sql``}
        ${from ? sql`AND created_at >= ${from}` : sql``}
        ${to ? sql`AND created_at <= ${to}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return rows.map(mapGatewayAuditSqlRow);
  }

  async getEventByRequestId(
    requestId: string,
    tenantId: string,
  ): Promise<IStoredGatewayAuditEvent | null> {
    await this.ensureGatewayAuditTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const rows = await sql<Parameters<typeof mapGatewayAuditSqlRow>[0][]>`
      SELECT ${sql.unsafe(GATEWAY_AUDIT_SELECT_PROJECTION)}
      FROM gateway_audit_events
      WHERE request_id = ${requestId}
    `;
    const row = rows[0];
    return row ? mapGatewayAuditSqlRow(row) : null;
  }

  private async getRequestCounts(sql: Sql): Promise<IAggregateRow[]> {
    return sql<IAggregateRow[]>`
      SELECT
        COUNT(*) FILTER (
          WHERE created_at >= DATE_TRUNC('day', NOW())
        ) AS requests_today,
        COUNT(*) FILTER (
          WHERE created_at >= DATE_TRUNC('day', NOW()) - INTERVAL '1 day'
            AND created_at < DATE_TRUNC('day', NOW())
        ) AS requests_yesterday,
        COUNT(*) FILTER (
          WHERE status_code >= 400
            AND created_at >= DATE_TRUNC('day', NOW())
        ) AS error_count_today,
        COUNT(*) FILTER (
          WHERE status_code >= 400
            AND created_at >= DATE_TRUNC('day', NOW()) - INTERVAL '1 day'
            AND created_at < DATE_TRUNC('day', NOW())
        ) AS error_count_yesterday,
        AVG(duration_ms) FILTER (
          WHERE created_at >= DATE_TRUNC('day', NOW())
        ) AS avg_response_ms,
        AVG(duration_ms) FILTER (
          WHERE created_at >= DATE_TRUNC('day', NOW()) - INTERVAL '1 day'
            AND created_at < DATE_TRUNC('day', NOW())
        ) AS avg_response_ms_yesterday,
        PERCENTILE_CONT(0.95) WITHIN GROUP (
          ORDER BY duration_ms
        ) AS p95_response_ms,
        COUNT(DISTINCT jwt_subject) FILTER (
          WHERE created_at >= NOW() - INTERVAL '15 minutes'
            AND jwt_subject IS NOT NULL
        ) AS active_sessions
      FROM gateway_audit_events
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `;
  }

  private async getDailyVolumeAndLatencyByDay(sql: Sql): Promise<IDailyRow[]> {
    return sql<IDailyRow[]>`
      SELECT
        DATE_TRUNC('day', created_at)::date::text AS day,
        COUNT(*)::text AS requests,
        AVG(duration_ms)::text AS avg_latency_ms
      FROM gateway_audit_events
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY day ASC
    `;
  }

  private async getRecentGatewayRequests(sql: Sql): Promise<IRecentRow[]> {
    return sql<IRecentRow[]>`
      SELECT method, path, status_code, created_at
      FROM gateway_audit_events
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 20
    `;
  }

  async getDashboardStats(tenantId: string): Promise<AuditDashboardStats> {
    await this.ensureGatewayAuditTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const [aggregateRows, dailyRows, recentRows] = await Promise.all([
      this.getRequestCounts(sql),
      this.getDailyVolumeAndLatencyByDay(sql),
      this.getRecentGatewayRequests(sql),
    ]);

    const agg = aggregateRows[0];
    const requestsToday = Number(agg?.requests_today ?? 0);
    const requestsYesterday = Number(agg?.requests_yesterday ?? 0);
    const errorCountToday = Number(agg?.error_count_today ?? 0);
    const errorCountYesterday = Number(agg?.error_count_yesterday ?? 0);

    const errorRate =
      requestsToday > 0 ? (errorCountToday / requestsToday) * 100 : 0;
    const errorRateYesterday =
      requestsYesterday > 0
        ? (errorCountYesterday / requestsYesterday) * 100
        : 0;

    const recentActivity: DashboardActivity[] = recentRows.map((r) => ({
      type: "gateway.request",
      text: `${r.method} ${r.path} -> ${r.status_code}`,
      timestamp: r.created_at,
    }));

    return {
      requestsToday,
      requestsYesterday,
      avgResponseMs: Math.round(Number(agg?.avg_response_ms ?? 0)),
      avgResponseMsYesterday: Math.round(
        Number(agg?.avg_response_ms_yesterday ?? 0),
      ),
      errorRate: Math.round(errorRate * 100) / 100,
      errorRateYesterday: Math.round(errorRateYesterday * 100) / 100,
      p95ResponseMs: Math.round(Number(agg?.p95_response_ms ?? 0)),
      activeSessions: Number(agg?.active_sessions ?? 0),
      dailyBreakdown: dailyRows.map((r) => ({
        date: r.day,
        requests: Number(r.requests),
        avgLatencyMs: Math.round(Number(r.avg_latency_ms ?? 0)),
      })),
      recentActivity,
    };
  }
}
