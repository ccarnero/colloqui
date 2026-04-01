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
import type { EventEnvelope, MetricsPayload } from '@yoizen/shared';

export interface IMetricRecord {
  id: string;
  source: string;
  name: string;
  value: number;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface MetricsQueryParams {
  source?: string;
  name?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
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
      CREATE TABLE IF NOT EXISTS metrics (
        id          TEXT             PRIMARY KEY,
        source      TEXT             NOT NULL,
        name        TEXT             NOT NULL,
        value       DOUBLE PRECISION NOT NULL DEFAULT 0,
        tags        JSONB            NOT NULL DEFAULT '{}',
        metadata    JSONB            NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_metrics_source ON metrics (source)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics (name)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_metrics_source_created ON metrics (source, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_metrics_created_at ON metrics (created_at DESC)`;

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
          this.logger.error(`Failed to persist metric: ${err}`);
          msg.nak();
        }
      }
    } catch {
      // iterator stopped
    }
  }

  private async persistMessage(msg: JsMsg): Promise<void> {
    const envelope = msg.json() as EventEnvelope;
    const tenantId = envelope.tenant;
    if (!tenantId) {
      this.logger.warn(`Dropping metric ${envelope.id}: missing tenant`);
      return;
    }

    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const payload = (envelope.data.payload ?? {}) as unknown as MetricsPayload;

    const source = payload.source ?? 'unknown';
    const name = payload.name ?? 'unnamed';
    const value = typeof payload.value === 'number' ? payload.value : 0;
    const tags = payload.tags ?? {};
    const metadata = {
      tenant: envelope.tenant,
      source: envelope.source,
      correlation_id: envelope.correlation_id,
      traceid: envelope.traceid,
    };
    const createdAt = payload.timestamp
      ? new Date(payload.timestamp).toISOString()
      : undefined;

    if (createdAt) {
      await sql`
        INSERT INTO metrics (id, source, name, value, tags, metadata, created_at)
        VALUES (
          ${envelope.id},
          ${source},
          ${name},
          ${value},
          ${JSON.stringify(tags)},
          ${JSON.stringify(metadata)},
          ${createdAt}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    } else {
      await sql`
        INSERT INTO metrics (id, source, name, value, tags, metadata)
        VALUES (
          ${envelope.id},
          ${source},
          ${name},
          ${value},
          ${JSON.stringify(tags)},
          ${JSON.stringify(metadata)}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
  }

  async queryMetrics(params: MetricsQueryParams, tenantId: string): Promise<IMetricRecord[]> {
    const { source, name, from, to, limit, offset } = params;
    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const rows = await sql<IMetricRecord[]>`
      SELECT id, source, name, value, tags, metadata, created_at
      FROM metrics
      WHERE 1=1
        ${source ? sql`AND source = ${source}` : sql``}
        ${name ? sql`AND name = ${name}` : sql``}
        ${from ? sql`AND created_at >= ${from}` : sql``}
        ${to ? sql`AND created_at <= ${to}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return rows;
  }

  async getMetricById(id: string, tenantId: string): Promise<IMetricRecord | null> {
    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const rows = await sql<IMetricRecord[]>`
      SELECT id, source, name, value, tags, metadata, created_at
      FROM metrics
      WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }
}
