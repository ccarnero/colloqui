import type { EventEnvelope } from "./interfaces";

export type Channel = "whatsapp" | "instagram" | "telegram";
export type ChannelProvider = "meta" | "telegram";
export type MessageKind =
  | "received"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "send";

/**
 * Channel envelope — canonical `EventEnvelope` (wdocs 02 §2) tagged
 * with the channel taxonomy (`channel`, `provider`, `kind`).
 *
 * Subject is reconstructed via `buildChannelSubject` on publish;
 * consumers can parse it back with `parseChannelSubject` from the
 * NATS message metadata. All identity / causal fields live in the
 * canonical snake_case properties of `EventEnvelope`.
 */
export interface ChannelEnvelope extends EventEnvelope {
  channel: Channel;
  provider: ChannelProvider;
  kind: MessageKind;
}

export interface ChannelAccount {
  id: string;
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  name: string;
  externalId: string;
  phoneNumberId?: string;
  wabaId?: string;
  igUserId?: string;
  telegramBotToken?: string;
  accessToken: string;
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InboundMessage {
  messageId: string;
  from: string;
  timestamp: string;
  type: string;
  text?: string;
  media?: MessageMedia;
  raw: Record<string, unknown>;
}

export interface OutboundMessage {
  to: string;
  type: "text" | "template" | "image" | "document";
  text?: string;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: Record<string, unknown>[];
  mediaUrl?: string;
  caption?: string;
}

export interface MessageMedia {
  mimeType: string;
  id?: string;
  url?: string;
  caption?: string;
}

export interface SendMessageResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  timestamp: string;
}

export interface IChannelProvider {
  readonly channel: Channel;
  readonly provider: ChannelProvider;
  /** HTTP header that carries the webhook signature for this provider. */
  readonly signatureHeader?: string;

  parseWebhook(
    rawBody: Record<string, unknown>,
  ): InboundMessage[];

  sendMessage(
    account: ChannelAccount,
    message: OutboundMessage,
  ): Promise<SendMessageResult>;

  verifySignature(
    rawBody: Uint8Array,
    signature: string,
    secret: string,
  ): boolean;
}

export interface AutoReplyRule {
  id: string;
  tenantId: string;
  accountId: string;
  channel: Channel;
  triggerPattern: string;
  replyText: string;
  isActive: boolean;
}
