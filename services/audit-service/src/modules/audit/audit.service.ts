import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Consumer, JsMsg } from 'nats';
import { JETSTREAM_CLIENT } from '../../providers/nats.provider';
import { TenantConnectionManager, type Sql } from '../../providers/tenant-connection-manager';
import type { EventEnvelope } from '@yoizen/shared';

export interface AuditEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  subject: string;
  created_at: string;
}

interface AuditQueryParams {
  type?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private consumeIterator: Awaited<
    ReturnType<Consumer['consume']>
  > | null = null;

  constructor(
    @Inject(JETSTREAM_CLIENT) private readonly consumer: Consumer,
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
    if (this.tenantConnections.isInitialized(tenantId)) return;

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

    this.tenantConnections.markInitialized(tenantId);
  }

  private async runConsumer(): Promise<void> {
    if (!this.consumeIterator) return;
    try {
      for await (const msg of this.consumeIterator) {
        try {
          await this.persistMessage(msg);
          msg.ack();
        } catch (err) {
          this.logger.error(`Failed to persist event: ${err}`);
          msg.nak();
        }
      }
    } catch {
      // iterator stopped
    }
  }

  private async persistMessage(msg: JsMsg): Promise<void> {
    const envelope = msg.json() as EventEnvelope;
    const tenantId = envelope.metadata?.tenantId;
    if (!tenantId) {
      this.logger.warn(`Dropping event ${envelope.id}: missing tenantId in metadata`);
      return;
    }

    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const subject = msg.subject;

    await sql`
      INSERT INTO events (id, type, payload, metadata, subject)
      VALUES (
        ${envelope.id},
        ${envelope.type},
        ${JSON.stringify(envelope.payload)},
        ${JSON.stringify(envelope.metadata ?? {})},
        ${subject}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async queryEvents(params: AuditQueryParams, tenantId: string): Promise<AuditEvent[]> {
    const { type, from, to, limit, offset } = params;
    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const rows = await sql<AuditEvent[]>`
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

    return rows;
  }

  async getEventById(id: string, tenantId: string): Promise<AuditEvent | null> {
    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const rows = await sql<AuditEvent[]>`
      SELECT id, type, payload, metadata, subject, created_at
      FROM events
      WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }

}
