import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import type { EventEnvelope } from "@yoizen/shared";
import type { IAuditQueryParams } from "../../common/audit-query-params";
import { ensurePostgresTenantSchemaOnce } from "../../common/ensure-tenant-schema.postgres";
import { AuditTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IAuditEvent,
  IAuditRepository,
} from "./audit.repository.interface";
import { MAX_CHAIN_NODES } from "./build-chain-tree";

@Injectable()
export class AuditPostgresRepository implements IAuditRepository {
  constructor(
    @Inject(AuditTenantConnectionManager)
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  private async ensureEventsTable(tenantId: string): Promise<void> {
    await ensurePostgresTenantSchemaOnce(
      this.tenantConnections,
      tenantId,
      async (sql) => {
        await sql`
          CREATE TABLE IF NOT EXISTS events (
            id             TEXT        PRIMARY KEY,
            type           TEXT        NOT NULL,
            payload        JSONB       NOT NULL DEFAULT '{}',
            metadata       JSONB       NOT NULL DEFAULT '{}',
            subject        TEXT        NOT NULL DEFAULT '',
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            correlation_id TEXT,
            causation_id   TEXT,
            depth          INTEGER     NOT NULL DEFAULT 0
          )
        `;
        await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS correlation_id TEXT`;
        await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS causation_id   TEXT`;
        await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS depth          INTEGER NOT NULL DEFAULT 0`;
        await sql`CREATE INDEX IF NOT EXISTS idx_events_type ON events (type)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at DESC)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_events_type_created ON events (type, created_at DESC)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_events_correlation ON events (correlation_id, depth, created_at)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_events_causation   ON events (causation_id)`;
      }
    );
  }

  async insertAuditEvent(
    tenantId: string,
    envelope: EventEnvelope,
    subject: string
  ): Promise<void> {
    await this.ensureEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const payload = envelope.data.payload ?? {};
    const metadata = {
      tenant: envelope.tenant,
      source: envelope.source,
      correlation_id: envelope.correlation_id,
      traceid: envelope.traceid,
    };

    const correlationId = envelope.correlation_id ?? null;
    const causationId = envelope.causation_id ?? null;
    const depth = envelope.transport?.depth ?? 0;

    await sql`
      INSERT INTO events (id, type, payload, metadata, subject, correlation_id, causation_id, depth)
      VALUES (
        ${envelope.id},
        ${envelope.type},
        ${JSON.stringify(payload)},
        ${JSON.stringify(metadata)},
        ${subject},
        ${correlationId},
        ${causationId},
        ${depth}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async queryEvents(
    params: IAuditQueryParams,
    tenantId: string
  ): Promise<IAuditEvent[]> {
    const { type, from, to, limit, offset, correlation_id } = params;
    await this.ensureEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    return sql<IAuditEvent[]>`
      SELECT id, type, payload, metadata, subject, created_at,
             correlation_id, causation_id, depth
      FROM events
      WHERE 1=1
        ${type ? sql`AND type = ${type}` : sql``}
        ${correlation_id ? sql`AND correlation_id = ${correlation_id}` : sql``}
        ${from ? sql`AND created_at >= ${from}` : sql``}
        ${to ? sql`AND created_at <= ${to}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }

  async getEventById(
    id: string,
    tenantId: string
  ): Promise<IAuditEvent | null> {
    await this.ensureEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const rows = await sql<IAuditEvent[]>`
      SELECT id, type, payload, metadata, subject, created_at,
             correlation_id, causation_id, depth
      FROM events
      WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }

  async findByCorrelationId(
    correlationId: string,
    tenantId: string
  ): Promise<IAuditEvent[]> {
    await this.ensureEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);
    // Fetch one extra row so buildChainTree can detect truncation
    const cap = MAX_CHAIN_NODES + 1;

    return sql<IAuditEvent[]>`
      SELECT id, type, payload, metadata, subject, created_at,
             correlation_id, causation_id, depth
      FROM events
      WHERE correlation_id = ${correlationId}
      ORDER BY depth ASC, created_at ASC
      LIMIT ${cap}
    `;
  }
}
