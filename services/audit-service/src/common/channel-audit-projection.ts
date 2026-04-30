/**
 * Shared SELECT list for `channel_events` row mapping (camelCase aliases).
 * Used by list and single-row queries to avoid drift.
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
