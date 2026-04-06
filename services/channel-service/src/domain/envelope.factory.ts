import type {
  ChannelEnvelope,
  Channel,
  ChannelProvider,
  MessageKind,
  InboundMessage,
} from "@yoizen/shared";
import { buildChannelSubject } from "@yoizen/shared";

interface ICreateChannelEnvelopeOptions {
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  kind: MessageKind;
  message: InboundMessage;
  accountId: string;
}

/**
 * Creates a CloudEvents-compatible channel envelope from an inbound message.
 * Pure function — no side effects.
 */
export function createChannelEnvelope(
  options: ICreateChannelEnvelopeOptions,
): ChannelEnvelope {
  const { tenantId, channel, provider, kind, message, accountId } = options;
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
