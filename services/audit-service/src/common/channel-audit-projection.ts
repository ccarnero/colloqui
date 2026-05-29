import type { Document } from "mongodb";

/**
 * Shared SELECT list for `channel_events` row mapping (camelCase aliases).
 * Used by Postgres list and single-row queries to avoid drift.
 */
export const CHANNEL_AUDIT_SELECT_PROJECTION = `
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
`.trim();

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

function readDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return new Date().toISOString();
}

/**
 * Maps a Mongo `channel_events` audit document to the HTTP response shape.
 */
export function mapChannelAuditDoc(doc: Document): IStoredChannelEvent {
  const data = doc.data;
  return {
    id: String(doc._id ?? doc.id ?? ""),
    tenantId: String(doc.tenant_id ?? ""),
    channel: String(doc.channel ?? ""),
    provider: String(doc.provider ?? ""),
    kind: String(doc.kind ?? ""),
    accountId: String(doc.account_id ?? ""),
    fromId: (doc.from_id as string | null | undefined) ?? null,
    toId: (doc.to_id as string | null | undefined) ?? null,
    messageType: (doc.message_type as string | null | undefined) ?? null,
    messageText: (doc.message_text as string | null | undefined) ?? null,
    providerMessageId:
      (doc.provider_message_id as string | null | undefined) ?? null,
    data:
      typeof data === "object" && data !== null && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {},
    natsSubject: String(doc.nats_subject ?? ""),
    createdAt: readDate(doc.created_at),
  };
}
