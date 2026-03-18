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
import type { GatewayAuditEvent } from '@yoizen/shared';

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
}
