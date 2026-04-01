import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Consumer, JsMsg } from 'nats';
import { GATEWAY_AUDIT_CONSUMER } from '../../providers/nats.provider';
import { TenantConnectionManager, type Sql } from '../../providers/tenant-connection-manager';
import type {
  GatewayAuditEvent,
  AuditDashboardStats,
  DashboardActivity,
} from '@yoizen/shared';

export interface StoredGatewayAuditEvent extends GatewayAuditEvent {
  created_at: string;
}

interface GatewayAuditQueryParams {
  method?: string;
  routeType?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

interface AggregateRow {
  requests_today: string;
  requests_yesterday: string;
  error_count_today: string;
  error_count_yesterday: string;
  avg_response_ms: string | null;
  avg_response_ms_yesterday: string | null;
  p95_response_ms: string | null;
  active_sessions: string;
}

interface DailyRow {
  day: string;
  requests: string;
  avg_latency_ms: string | null;
}

interface RecentRow {
  method: string;
  path: string;
  status_code: number;
  created_at: string;
}

const TABLE_INIT_KEY_PREFIX = 'gw_audit:';

@Injectable()
export class GatewayAuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayAuditService.name);
  private consumeIterator: Awaited<ReturnType<Consumer['consume']>> | null = null;
  private readonly initializedTenants = new Set<string>();

  constructor(
    @Inject(GATEWAY_AUDIT_CONSUMER) private readonly consumer: Consumer,
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumeIterator = await this.consumer.consume({
      max_messages: 100,
      expires: 30_000,
    });
    this.runConsumer();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumeIterator) {
      this.consumeIterator.stop();
      this.consumeIterator = null;
    }
  }

  private async ensureTable(sql: Sql, tenantId: string): Promise<void> {
    const key = `${TABLE_INIT_KEY_PREFIX}${tenantId}`;
    if (this.initializedTenants.has(key)) return;

    await sql`
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
    await sql`CREATE INDEX IF NOT EXISTS idx_gw_audit_created ON gateway_audit_events (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_gw_audit_method ON gateway_audit_events (method, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_gw_audit_route_type ON gateway_audit_events (route_type, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_gw_audit_trace ON gateway_audit_events (trace_id)`;

    this.initializedTenants.add(key);
  }

  private async runConsumer(): Promise<void> {
    if (!this.consumeIterator) return;
    try {
      for await (const msg of this.consumeIterator) {
        try {
          await this.persistMessage(msg);
          msg.ack();
        } catch (err) {
          this.logger.error(`Failed to persist gateway audit event: ${err}`);
          msg.nak();
        }
      }
    } catch {
      // iterator stopped
    }
  }

  private async persistMessage(msg: JsMsg): Promise<void> {
    const event = msg.json() as GatewayAuditEvent;
    const tenantId = event.tenantId;
    if (!tenantId) return;

    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

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

  async queryEvents(params: GatewayAuditQueryParams, tenantId: string): Promise<StoredGatewayAuditEvent[]> {
    const { method, routeType, from, to, limit, offset } = params;
    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const rows = await sql<StoredGatewayAuditEvent[]>`
      SELECT
        request_id as "requestId",
        trace_id as "traceId",
        tenant_id as "tenantId",
        method,
        path,
        status_code as "statusCode",
        duration_ms as "durationMs",
        client_ip as "clientIp",
        user_agent as "userAgent",
        jwt_subject as "jwtSubject",
        route_type as "routeType",
        upstream_url as "upstreamUrl",
        upstream_status as "upstreamStatus",
        upstream_duration as "upstreamDuration",
        rate_limit_applied as "rateLimitApplied",
        rate_limit_remaining as "rateLimitRemaining",
        error,
        created_at
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

    return rows;
  }

  async getEventByRequestId(requestId: string, tenantId: string): Promise<StoredGatewayAuditEvent | null> {
    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const rows = await sql<StoredGatewayAuditEvent[]>`
      SELECT
        request_id as "requestId",
        trace_id as "traceId",
        tenant_id as "tenantId",
        method,
        path,
        status_code as "statusCode",
        duration_ms as "durationMs",
        client_ip as "clientIp",
        user_agent as "userAgent",
        jwt_subject as "jwtSubject",
        route_type as "routeType",
        upstream_url as "upstreamUrl",
        upstream_status as "upstreamStatus",
        upstream_duration as "upstreamDuration",
        rate_limit_applied as "rateLimitApplied",
        rate_limit_remaining as "rateLimitRemaining",
        error,
        created_at
      FROM gateway_audit_events
      WHERE request_id = ${requestId}
    `;
    return rows[0] ?? null;
  }

  /** Aggregate KPIs: request/error counts, latency, p95, active sessions (7d window). */
  private async getRequestCounts(sql: Sql): Promise<AggregateRow[]> {
    return sql<AggregateRow[]>`
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

  /** Per-day request volume and average latency (7d window). */
  private async getStatusDistribution(sql: Sql): Promise<DailyRow[]> {
    return sql<DailyRow[]>`
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

  /** Recent requests for activity feed (24h window). */
  private async getTopEndpoints(sql: Sql): Promise<RecentRow[]> {
    return sql<RecentRow[]>`
        SELECT method, path, status_code, created_at
        FROM gateway_audit_events
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 20
      `;
  }

  /**
   * Aggregated dashboard statistics from gateway_audit_events.
   * Runs three queries in parallel: KPIs, daily breakdown, recent activity.
   */
  async getDashboardStats(
    tenantId: string,
  ): Promise<AuditDashboardStats> {
    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const [aggregateRows, dailyRows, recentRows] = await Promise.all([
      this.getRequestCounts(sql),
      this.getStatusDistribution(sql),
      this.getTopEndpoints(sql),
    ]);

    const agg = aggregateRows[0];
    const requestsToday = Number(agg?.requests_today ?? 0);
    const requestsYesterday = Number(agg?.requests_yesterday ?? 0);
    const errorCountToday = Number(agg?.error_count_today ?? 0);
    const errorCountYesterday = Number(
      agg?.error_count_yesterday ?? 0,
    );

    const errorRate =
      requestsToday > 0
        ? (errorCountToday / requestsToday) * 100
        : 0;
    const errorRateYesterday =
      requestsYesterday > 0
        ? (errorCountYesterday / requestsYesterday) * 100
        : 0;

    const recentActivity: DashboardActivity[] = recentRows.map(
      (r) => ({
        type: "gateway.request",
        text: `${r.method} ${r.path} -> ${r.status_code}`,
        timestamp: r.created_at,
      }),
    );

    return {
      requestsToday,
      requestsYesterday,
      avgResponseMs: Math.round(
        Number(agg?.avg_response_ms ?? 0),
      ),
      avgResponseMsYesterday: Math.round(
        Number(agg?.avg_response_ms_yesterday ?? 0),
      ),
      errorRate: Math.round(errorRate * 100) / 100,
      errorRateYesterday:
        Math.round(errorRateYesterday * 100) / 100,
      p95ResponseMs: Math.round(
        Number(agg?.p95_response_ms ?? 0),
      ),
      activeSessions: Number(agg?.active_sessions ?? 0),
      dailyBreakdown: dailyRows.map((r) => ({
        date: r.day,
        requests: Number(r.requests),
        avgLatencyMs: Math.round(
          Number(r.avg_latency_ms ?? 0),
        ),
      })),
      recentActivity,
    };
  }
}
