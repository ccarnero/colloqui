import type { ChannelEnvelope } from "@yoizen/shared";
import type { IStoredChannelEvent } from "../../common/channel-audit-projection";

export const CHANNEL_AUDIT_REPOSITORY = Symbol("CHANNEL_AUDIT_REPOSITORY");

export interface IChannelAuditQueryParams {
  channel?: string;
  kind?: string;
  accountId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface IChannelAuditRepository {
  insertChannelEvent(
    envelope: ChannelEnvelope,
    natsSubject: string,
  ): Promise<void>;
  queryEvents(
    params: IChannelAuditQueryParams,
    tenantId: string,
  ): Promise<IStoredChannelEvent[]>;
  getEventById(
    id: string,
    tenantId: string,
  ): Promise<IStoredChannelEvent | null>;
  findByCorrelationId(
    correlationId: string,
    tenantId: string,
  ): Promise<IStoredChannelEvent[]>;
}
