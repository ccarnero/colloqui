import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { NatsConnection, Subscription } from "nats";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import {
  TenantConnectionManager,
  type Sql,
} from "../../providers/tenant-connection-manager";
import {
  CHANNEL_AUDIT_SUBJECT_PATTERN,
  type ChannelEnvelope,
} from "@yoizen/shared";

export interface StoredChannelEvent {
  id: string;
  tenantId: string;
  channel: string;
  provider: string;
  kind: string;
  accountId: string;
  fromId: string | null;
  toId: string | null;
  messageType: string | null;
  messageText: string | null;
  providerMessageId: string | null;
  data: Record<string, unknown>;
  natsSubject: string;
  createdAt: string;
}

interface ChannelAuditQueryParams {
  channel?: string;
  kind?: string;
  accountId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

const TABLE_INIT_KEY = "channel_audit:";

@Injectable()
export class ChannelAuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelAuditService.name);
  private subscription: Subscription | null = null;
  private readonly initializedTenants = new Set<string>();

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = this.nc.subscribe(CHANNEL_AUDIT_SUBJECT_PATTERN, {
      callback: (_err, msg) => {
        this.handleMessage(msg).catch((err) => {
          this.logger.warn(
            `Channel audit persist error: ${err instanceof Error ? err.message : err}`,
          );
        });
      },
    });

    this.logger.log(
      `Channel audit subscribed to: ${CHANNEL_AUDIT_SUBJECT_PATTERN}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  private async handleMessage(msg: {
    data: Uint8Array;
    subject: string;
  }): Promise<void> {
    const decoder = new TextDecoder();
    const envelope = JSON.parse(
      decoder.decode(msg.data),
    ) as ChannelEnvelope;

    const { tenantId } = envelope;
    if (!tenantId) return;

    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const data = envelope.data ?? {};

    await sql`
      INSERT INTO channel_events (
        id, tenant_id, channel, provider, kind,
        account_id, from_id, to_id,
        message_type, message_text, provider_message_id,
        data, nats_subject, created_at
      ) VALUES (
        ${envelope.id},
        ${tenantId},
        ${envelope.channel},
        ${envelope.provider},
        ${envelope.kind},
        ${(data.accountId as string) ?? null},
        ${(data.from as string) ?? null},
        ${(data.to as string) ?? null},
        ${(data.type as string) ?? null},
        ${(data.text as string) ?? null},
        ${(data.providerMessageId as string) ?? null},
        ${JSON.stringify(data)},
        ${msg.subject},
        ${envelope.time ?? new Date().toISOString()}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  private async ensureTable(sql: Sql, tenantId: string): Promise<void> {
    const key = `${TABLE_INIT_KEY}${tenantId}`;
    if (this.initializedTenants.has(key)) return;

    await sql`
      CREATE TABLE IF NOT EXISTS channel_events (
        id                  TEXT        PRIMARY KEY,
        tenant_id           TEXT        NOT NULL,
        channel             TEXT        NOT NULL,
        provider            TEXT        NOT NULL,
        kind                TEXT        NOT NULL,
        account_id          TEXT,
        from_id             TEXT,
        to_id               TEXT,
        message_type        TEXT,
        message_text        TEXT,
        provider_message_id TEXT,
        data                JSONB       NOT NULL DEFAULT '{}',
        nats_subject        TEXT        NOT NULL DEFAULT '',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ch_evt_created ON channel_events (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ch_evt_channel ON channel_events (channel, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ch_evt_kind ON channel_events (kind, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ch_evt_account ON channel_events (account_id, created_at DESC)`;

    this.initializedTenants.add(key);
  }

  async queryEvents(
    params: ChannelAuditQueryParams,
    tenantId: string,
  ): Promise<StoredChannelEvent[]> {
    const { channel, kind, accountId, from, to, limit, offset } = params;
    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const rows = await sql<StoredChannelEvent[]>`
      SELECT
        id,
        tenant_id     AS "tenantId",
        channel,
        provider,
        kind,
        account_id    AS "accountId",
        from_id       AS "fromId",
        to_id         AS "toId",
        message_type  AS "messageType",
        message_text  AS "messageText",
        provider_message_id AS "providerMessageId",
        data,
        nats_subject  AS "natsSubject",
        created_at    AS "createdAt"
      FROM channel_events
      WHERE 1=1
        ${channel ? sql`AND channel = ${channel}` : sql``}
        ${kind ? sql`AND kind = ${kind}` : sql``}
        ${accountId ? sql`AND account_id = ${accountId}` : sql``}
        ${from ? sql`AND created_at >= ${from}` : sql``}
        ${to ? sql`AND created_at <= ${to}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return rows;
  }

  async getEventById(
    id: string,
    tenantId: string,
  ): Promise<StoredChannelEvent | null> {
    const sql = this.tenantConnections.getConnection(tenantId);
    await this.ensureTable(sql, tenantId);

    const rows = await sql<StoredChannelEvent[]>`
      SELECT
        id,
        tenant_id     AS "tenantId",
        channel,
        provider,
        kind,
        account_id    AS "accountId",
        from_id       AS "fromId",
        to_id         AS "toId",
        message_type  AS "messageType",
        message_text  AS "messageText",
        provider_message_id AS "providerMessageId",
        data,
        nats_subject  AS "natsSubject",
        created_at    AS "createdAt"
      FROM channel_events
      WHERE id = ${id}
    `;

    return rows[0] ?? null;
  }
}
