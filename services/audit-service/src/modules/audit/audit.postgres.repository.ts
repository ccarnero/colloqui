import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import type { EventEnvelope } from "@yoizen/shared";
import type { IAuditQueryParams } from "../../common/audit-query-params";
import {
  ensurePostgresTenantSchemaOnce,
} from "../../common/ensure-tenant-schema.postgres";
import { AuditTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type { IAuditEvent, IAuditRepository } from "./audit.repository.interface";

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
