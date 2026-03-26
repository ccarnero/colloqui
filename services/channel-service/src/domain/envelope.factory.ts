import type {
  ChannelEnvelope,
  Channel,
  ChannelProvider,
  MessageKind,
  InboundMessage,
} from "@yoizen/shared";
import { buildChannelSubject } from "@yoizen/shared";

/**
 * Creates a CloudEvents-compatible channel envelope from an inbound message.
 * Pure function — no side effects.
 */
export function createChannelEnvelope(
  tenantId: string,
  channel: Channel,
  provider: ChannelProvider,
  kind: MessageKind,
  message: InboundMessage,
  accountId: string,
): ChannelEnvelope {
  const id = crypto.randomUUID();
  const subject = buildChannelSubject(tenantId, channel, provider, kind);

  return {
    id,
    specversion: "1.0",
    type: `io.yoizen.messaging.${channel}.${provider}.${kind}.v1`,
    source: `//channel-service/accounts/${accountId}`,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    subject,
    data: {
      messageId: message.messageId,
      from: message.from,
      timestamp: message.timestamp,
      type: message.type,
      ...(message.text !== undefined && { text: message.text }),
      ...(message.media !== undefined && { media: message.media }),
      accountId,
    },
    tenantId,
    channel,
    provider,
    kind,
    idempotencyKey: `${tenantId}:${channel}:${message.messageId}`,
  };
}

/**
 * Generates a deterministic idempotency key for deduplication via Nats-Msg-Id.
 */
export function buildIdempotencyKey(
  tenantId: string,
  channel: Channel,
  providerMessageId: string,
): string {
  return `${tenantId}:${channel}:${providerMessageId}`;
}
