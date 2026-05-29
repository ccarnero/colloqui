import { Inject, Injectable } from "@nestjs/common";
import {
  isMongoDuplicateKeyError,
  type IStringIdDoc,
  type TenantMongoConnectionManager,
} from "@yoizen/database";
import {
  CHANNEL_AUDIT_EVENTS_MONGO_SCHEMA,
  CHANNEL_AUDIT_MONGO_NAMESPACE,
  type ChannelEnvelope,
} from "@yoizen/shared";
import type { Filter } from "mongodb";
import {
  mapChannelAuditDoc,
  type IStoredChannelEvent,
} from "../../common/channel-audit-projection";
import { ensureTenantNamespaceOnce } from "../../common/ensure-tenant-schema";
import { AuditTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IChannelAuditQueryParams,
  IChannelAuditRepository,
} from "./channel-audit.repository.interface";

@Injectable()
export class ChannelAuditMongoRepository implements IChannelAuditRepository {
  constructor(
    @Inject(AuditTenantConnectionManager)
    private readonly tenantConnections: TenantMongoConnectionManager,
  ) {}

  private async channelEventsCollection(tenantId: string) {
    const db = await ensureTenantNamespaceOnce(
      this.tenantConnections,
      tenantId,
      CHANNEL_AUDIT_MONGO_NAMESPACE,
      CHANNEL_AUDIT_EVENTS_MONGO_SCHEMA,
    );
    return db.collection<IStringIdDoc>("channel_events");
  }

  async insertChannelEvent(
    envelope: ChannelEnvelope,
    natsSubject: string,
  ): Promise<void> {
    const tenantId = envelope.tenant;
    if (!tenantId) return;

    const collection = await this.channelEventsCollection(tenantId);

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

    const doc = {
      _id: envelope.id,
      tenant_id: tenantId,
      channel: envelope.channel,
      provider: envelope.provider,
      kind: envelope.kind,
      account_id: accountId,
      from_id: fromId,
      to_id: toId,
      message_type: messageType,
      message_text: messageText,
      provider_message_id: providerMessageId,
      data,
      nats_subject: natsSubject,
      created_at: new Date(envelope.time ?? new Date().toISOString()),
    };

    try {
      await collection.insertMany([doc], { ordered: false });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        return;
      }
      throw error;
    }
  }

  async queryEvents(
    params: IChannelAuditQueryParams,
    tenantId: string,
  ): Promise<IStoredChannelEvent[]> {
    const { channel, kind, accountId, from, to, limit, offset } = params;
    const collection = await this.channelEventsCollection(tenantId);

    const filter: Filter<IStringIdDoc> = {};
    if (channel) {
      filter.channel = channel;
    }
    if (kind) {
      filter.kind = kind;
    }
    if (accountId) {
      filter.account_id = accountId;
    }
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) {
        createdAt.$gte = new Date(from);
      }
      if (to) {
        createdAt.$lte = new Date(to);
      }
      filter.created_at = createdAt;
    }

    const docs = await collection
      .find(filter)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return docs.map((doc) => mapChannelAuditDoc(doc));
  }

  async getEventById(
    id: string,
    tenantId: string,
  ): Promise<IStoredChannelEvent | null> {
    const collection = await this.channelEventsCollection(tenantId);
    const doc = await collection.findOne({ _id: id });
    return doc ? mapChannelAuditDoc(doc) : null;
  }
}
