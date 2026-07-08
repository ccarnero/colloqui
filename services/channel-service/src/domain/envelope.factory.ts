import { activeOrRandomTraceId } from "@yoizen/observability";
import type {
  Channel,
  ChannelEnvelope,
  ChannelProvider,
  InboundMessage,
  JsonValue,
  MessageKind,
} from "@yoizen/shared";
import {
  CHANNEL_DOMAIN,
  CHANNEL_PRODUCER,
  canonicalByteLength,
  computeIdempotencyKey,
  computePayloadChecksum,
} from "@yoizen/shared";

interface ICreateChannelEnvelopeOptions {
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  kind: MessageKind;
  message: InboundMessage;
  accountId: string;
  /** Optional correlation id; defaults to the envelope id. */
  correlationId?: string;
  /** Optional causation id for derived events; defaults to null. */
  causationId?: string | null;
  /** Causal depth propagated from the incoming event. Defaults to 0. */
  depth?: number;
  /** Webhook headers allowlist (§4.1). */
  webhookHeaders?: Record<string, string>;
}

/**
 * Creates a compliant envelope for a channel messaging event
 * (DOCS/messaging/envelope.md §2). Output satisfies both the canonical `EventEnvelope` shape
 * **and** the legacy `ChannelEnvelope` camelCase aliases so in-flight
 * consumers keep working during the migration window.
 *
 * Pure function. No side effects.
 */
export function createChannelEnvelope(
  options: ICreateChannelEnvelopeOptions
): ChannelEnvelope {
  const {
    tenantId,
    channel,
    provider,
    kind,
    message,
    accountId,
    correlationId,
    causationId = null,
    depth = 0,
    webhookHeaders,
  } = options;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const traceid = activeOrRandomTraceId();

  const rawPayload: Record<string, JsonValue> = {
    messageId: message.messageId,
    from: message.from,
    timestamp: message.timestamp,
    type: message.type,
    ...(message.text !== undefined && { text: message.text }),
    ...(message.media !== undefined && {
      media: message.media as unknown as JsonValue,
    }),
    ...(message.raw !== undefined && {
      raw: message.raw as unknown as JsonValue,
    }),
    ...(message.conversationId !== undefined && {
      conversationId: message.conversationId,
    }),
  };

  const idempotencykey = computeIdempotencyKey(rawPayload);
  const payloadChecksum = computePayloadChecksum(rawPayload);
  const payloadBytes = canonicalByteLength(rawPayload);
  const resource = `tenant/${tenantId}/account/${accountId}/channel/${channel}/provider/${provider}`;

  return {
    specversion: "1.0",
    id,
    source: `//channel-service/accounts/${accountId}`,
    type: `io.yoizen.messaging.${channel}.${provider}.${kind}.v1`,
    resource,
    time: now,
    traceid,
    causation_id: causationId,
    correlation_id: correlationId ?? id,
    tenant: tenantId,
    producer: CHANNEL_PRODUCER,
    domain: CHANNEL_DOMAIN,
    channel,
    provider,
    accountid: accountId,
    idempotencykey,
    transport: {
      method: "webhook",
      protocol: "https",
      depth,
      ...(webhookHeaders && { headers: webhookHeaders }),
    },
    data: {
      received_at: now,
      payload_inline: true,
      payload_ref: null,
      payload_bytes: payloadBytes,
      payload_checksum: payloadChecksum,
      payload: {
        messageId: message.messageId,
        from: message.from,
        timestamp: message.timestamp,
        type: message.type,
        ...(message.text !== undefined && { text: message.text }),
        ...(message.media !== undefined && {
          media: message.media as unknown as JsonValue,
        }),
        ...(message.conversationId !== undefined && {
          conversationId: message.conversationId,
        }),
        accountId,
      },
    },
    kind,
  };
}

/**
 * Builds a compliant envelope for an **outbound** channel event
 * (provider-side `sent` / `delivered` / `send` shadows). Keeps the
 * legacy ChannelEnvelope aliases populated.
 */
export function createChannelSentEnvelope(options: {
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  accountId: string;
  kind: MessageKind;
  source: string;
  type: string;
  payload: Record<string, JsonValue>;
  correlationId?: string;
  causationId?: string | null;
  depth?: number;
}): ChannelEnvelope {
  const {
    tenantId,
    channel,
    provider,
    accountId,
    kind,
    source,
    type,
    payload,
    correlationId,
    causationId = null,
    depth = 0,
  } = options;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const traceid = activeOrRandomTraceId();
  const idempotencykey = computeIdempotencyKey(payload);
  const payloadChecksum = computePayloadChecksum(payload);
  const payloadBytes = canonicalByteLength(payload);
  const resource = `tenant/${tenantId}/account/${accountId}/channel/${channel}/provider/${provider}`;

  return {
    specversion: "1.0",
    id,
    source,
    type,
    resource,
    time: now,
    traceid,
    causation_id: causationId,
    correlation_id: correlationId ?? id,
    tenant: tenantId,
    producer: CHANNEL_PRODUCER,
    domain: CHANNEL_DOMAIN,
    channel,
    provider,
    accountid: accountId,
    idempotencykey,
    transport: {
      method: "stream",
      protocol: "internal",
      depth,
    },
    data: {
      received_at: now,
      payload_inline: true,
      payload_ref: null,
      payload_bytes: payloadBytes,
      payload_checksum: payloadChecksum,
      payload,
    },
    kind,
  };
}
