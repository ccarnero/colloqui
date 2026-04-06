import { Injectable } from "@nestjs/common";
import { TenantConnectionManager } from "@yoizen/database";
import type { EventEnvelope } from "@yoizen/shared";
import type { IAuditQueryParams } from "../../common/audit-query-params";
import { ensureTenantSchemaOnce } from "../../common/ensure-tenant-schema";

export interface IAuditEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  subject: string;
  created_at: string;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly tenantConnections: TenantConnectionManager) {}

  private async ensureEventsTable(tenantId: string): Promise<void> {
    await ensureTenantSchemaOnce(
      this.tenantConnections,
      tenantId,
      async (sql) => {
        await sql`
          CREATE TABLE IF NOT EXISTS events (
            id          TEXT        PRIMARY KEY,
            type        TEXT        NOT NULL,
            payload     JSONB       NOT NULL DEFAULT '{}',
            metadata    JSONB       NOT NULL DEFAULT '{}',
            subject     TEXT        NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `;
        await sql`CREATE INDEX IF NOT EXISTS idx_events_type ON events (type)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at DESC)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_events_type_created ON events (type, created_at DESC)`;
      },
    );
  }

  async insertAuditEvent(
    tenantId: string,
    envelope: EventEnvelope,
    subject: string,
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

    await sql`
      INSERT INTO events (id, type, payload, metadata, subject)
      VALUES (
        ${envelope.id},
        ${envelope.type},
        ${JSON.stringify(payload)},
        ${JSON.stringify(metadata)},
        ${subject}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async queryEvents(
    params: IAuditQueryParams,
    tenantId: string,
  ): Promise<IAuditEvent[]> {
    const { type, from, to, limit, offset } = params;
    await this.ensureEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    return sql<IAuditEvent[]>`
      SELECT id, type, payload, metadata, subject, created_at
      FROM events
      WHERE 1=1
        ${type ? sql`AND type = ${type}` : sql``}
        ${from ? sql`AND created_at >= ${from}` : sql``}
        ${to ? sql`AND created_at <= ${to}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }

  async getEventById(id: string, tenantId: string): Promise<IAuditEvent | null> {
    await this.ensureEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const rows = await sql<IAuditEvent[]>`
      SELECT id, type, payload, metadata, subject, created_at
      FROM events
      WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }
}
