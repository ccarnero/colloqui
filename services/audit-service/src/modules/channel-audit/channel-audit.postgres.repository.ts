import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import type { ChannelEnvelope } from "@yoizen/shared";
import {
  CHANNEL_AUDIT_SELECT_PROJECTION,
  type IStoredChannelEvent,
} from "../../common/channel-audit-projection";
import {
  ensurePostgresTenantNamespaceOnce,
} from "../../common/ensure-tenant-schema.postgres";
import { AuditTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IChannelAuditQueryParams,
  IChannelAuditRepository,
} from "./channel-audit.repository.interface";

@Injectable()
export class ChannelAuditPostgresRepository implements IChannelAuditRepository {
  constructor(
    @Inject(AuditTenantConnectionManager)
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  private async ensureChannelEventsTable(tenantId: string): Promise<void> {
    await ensurePostgresTenantNamespaceOnce(
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

  async insertChannelEvent(
    envelope: ChannelEnvelope,
    natsSubject: string,
  ): Promise<void> {
    const tenantId = envelope.tenant;
    if (!tenantId) return;

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
  }

  async queryEvents(
    params: IChannelAuditQueryParams,
    tenantId: string,
  ): Promise<IStoredChannelEvent[]> {
    const { channel, kind, accountId, from, to, limit, offset } = params;
    await this.ensureChannelEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    return sql<IStoredChannelEvent[]>`
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
