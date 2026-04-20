import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
} from "nats";
import { context as otelContext } from "@opentelemetry/api";
import {
  PinoLoggerService,
  logWithEnvelope,
  startNatsConsumerSpan,
  createNatsConsumerMetrics,
} from "@yoizen/observability";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import {
  MultiTenantConsumerManager,
  TenantConnectionManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  CHANNEL_AUDIT_SUBJECT_PATTERN,
  type ChannelEnvelope,
} from "@yoizen/shared";
import { CHANNEL_AUDIT_SELECT_PROJECTION } from "../../common/channel-audit-projection";
import { ensureTenantNamespaceOnce } from "../../common/ensure-tenant-schema";

const DURABLE_NAME = "channel-audit";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
/** Audit writes are I/O-bound Postgres inserts — parallel is safe + faster. */
const HANDLER_CONCURRENCY = 16;

export interface IStoredChannelEvent {
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

interface IChannelAuditQueryParams {
  channel?: string;
  kind?: string;
  accountId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class ChannelAuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(ChannelAuditService.name);
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  async onModuleInit(): Promise<void> {
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: CHANNEL_AUDIT_SUBJECT_PATTERN,
      description: "Channel messaging events audit writer",
      metrics: createNatsConsumerMetrics("audit-service"),
      runnerOptions: { concurrency: HANDLER_CONCURRENCY },
    };
    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.handleJsMessage(msg),
      this.logger,
    );
    await this.manager.start();
    this.logger.log(
      `Channel audit durable consumer ('${DURABLE_NAME}') started`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /** JetStream-path handler — throws on failure so runner NAKs. */
  private async handleJsMessage(msg: JsMsg): Promise<void> {
    const decoder = new TextDecoder();
    const envelope = JSON.parse(decoder.decode(msg.data)) as ChannelEnvelope;

    const incomingHeaders = msg.headers ?? {
      keys: () => [],
      values: () => [],
      get: () => "",
      set: () => {},
    };
    const { span, context: ctx } = startNatsConsumerSpan(
      "audit-service",
      msg.subject,
      incomingHeaders,
    );
    try {
      await otelContext.with(ctx, () =>
        this.persistChannelEnvelope(envelope, msg.subject),
      );
    } finally {
      span.end();
    }
  }

  private async persistChannelEnvelope(
    envelope: ChannelEnvelope,
    natsSubject: string,
  ): Promise<void> {
    const tenantId = envelope.tenant;
    if (!tenantId) {
      logWithEnvelope(
        this.logger,
        envelope,
        "channel-audit.dropped",
        "Dropping channel event: missing tenant",
        "warn",
      );
      return;
    }

    await this.ensureChannelEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const data = (envelope.data ?? {}) as unknown as Record<string, unknown>;
    const payload: Record<string, unknown> =
    (envelope.data?.payload as Record<string, unknown> | null | undefined) ??
    (envelope as unknown as Record<string, unknown>);
  

    const accountId =
      envelope.accountid ?? (payload.accountId as string | undefined) ?? null;
    const fromId = (payload.from as string | undefined) ?? null;
    const toId = (payload.to as string | undefined) ?? null;
    const messageType = (payload.type as string | undefined) ?? null;
    const messageText = (payload.text as string | undefined) ?? null;
    const providerMessageId =
      (payload.messageId as string | undefined) ??
      (payload.providerMessageId as string | undefined) ??
      null;

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
        ${accountId},
        ${fromId},
        ${toId},
        ${messageType},
        ${messageText},
        ${providerMessageId},
        ${JSON.stringify(data)},
        ${natsSubject},
        ${envelope.time ?? new Date().toISOString()}
      )
      ON CONFLICT (id) DO NOTHING
    `;

    logWithEnvelope(
      this.logger,
      envelope,
      "channel-audit.persist.ok",
      `Channel event persisted (subject=${natsSubject})`,
    );
  }

  private async ensureChannelEventsTable(tenantId: string): Promise<void> {
    await ensureTenantNamespaceOnce(
      this.tenantConnections,
      tenantId,
      "channel_audit",
      async (s) => {
        await s`
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
        await s`CREATE INDEX IF NOT EXISTS idx_ch_evt_created ON channel_events (created_at DESC)`;
        await s`CREATE INDEX IF NOT EXISTS idx_ch_evt_channel ON channel_events (channel, created_at DESC)`;
        await s`CREATE INDEX IF NOT EXISTS idx_ch_evt_kind ON channel_events (kind, created_at DESC)`;
        await s`CREATE INDEX IF NOT EXISTS idx_ch_evt_account ON channel_events (account_id, created_at DESC)`;
      },
    );
  }

  async queryEvents(
    params: IChannelAuditQueryParams,
    tenantId: string,
  ): Promise<IStoredChannelEvent[]> {
    const { channel, kind, accountId, from, to, limit, offset } = params;
    await this.ensureChannelEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const rows = await sql<IStoredChannelEvent[]>`
      SELECT ${sql.unsafe(CHANNEL_AUDIT_SELECT_PROJECTION)}
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
  ): Promise<IStoredChannelEvent | null> {
    await this.ensureChannelEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const rows = await sql<IStoredChannelEvent[]>`
      SELECT ${sql.unsafe(CHANNEL_AUDIT_SELECT_PROJECTION)}
      FROM channel_events
      WHERE id = ${id}
    `;

    return rows[0] ?? null;
  }
}
