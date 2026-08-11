import type { EventData, EventEnvelope } from "./interfaces";

// `e2e-tests` is an OUTBOUND-ONLY sink channel that exists so the egress path
// can be exercised by the automated suite. Before it, egress was structurally
// untestable: `http` is inbound-only BY DESIGN (its `sendMessage` always
// returns `success: false`) and the remaining real channel needs live
// third-party credentials, so `EgressService`'s `if (result.success)` branch —
// the one that calls `shadowPublish` and emits `sent.v1` — never ran under
// test. Its provider accepts the message, returns success and discards it;
// everything downstream of the provider is the SAME code Telegram runs, so
// what the suite covers is the real egress path, not a stand-in for it.
// See DOCS/channels/channel-service.md's channel table and
// scripts/e2e/http-workflow.sh's `channelSend` stage.
//
// Keep this union identical to `CHANNEL_ACCOUNTS_SCHEMA_SQL`'s two channel
// CHECK lists (channel-schema.ts) and to `CreateAccountDto`'s `@IsIn`.
export type Channel = "telegram" | "http" | "e2e-tests";
export type ChannelProvider = "telegram" | "http" | "e2e-tests";
export type MessageKind =
  | "received"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "send";

/**
 * Channel envelope — canonical `EventEnvelope` (DOCS/messaging/envelope.md §2) tagged
 * with the channel taxonomy (`channel`, `provider`, `kind`).
 *
 * Subject is reconstructed via `buildChannelSubject` on publish;
 * consumers can parse it back with `parseChannelSubject` from the
 * NATS message metadata. All identity / causal fields live in the
 * canonical snake_case properties of `EventEnvelope`.
 */
/**
 * Stage-2 `data` block: canonical `EventData` plus the webhook header
 * allowlist forwarded from stage 1.
 *
 * `headers` mirrors `IWebhookIngressData.headers`
 * (`webhook.interfaces.ts:18`) so the allowlist keeps the same shape and the
 * same home (`data`) on both sides of the webhook bridge, as
 * `DOCS/messaging/envelope.md` §4.1 prescribes.
 *
 * Optional: only envelopes derived from a provider webhook carry it. Before
 * envelope-drift T06 the allowlist was spread into `transport` instead —
 * untyped, since a conditional spread bypasses the excess-property check, and
 * `EventTransport` never declared a `headers` field.
 */
export interface IChannelEventData extends EventData {
  headers?: Record<string, string>;
}

export interface ChannelEnvelope extends EventEnvelope {
  channel: Channel;
  provider: ChannelProvider;
  kind: MessageKind;
  data: IChannelEventData;
}

export interface ChannelAccount {
  id: string;
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  name: string;
  externalId: string;
  telegramBotToken?: string;
  accessToken: string;
  /**
   * Webhook verification secret. Telegram sends it back in
   * `x-telegram-bot-api-secret-token`, Http in `x-http-channel-token`.
   * (The Meta-only `phoneNumberId` / `wabaId` / `igUserId` / `appId` /
   * `verifyToken` fields died with the Meta channel decommission, together
   * with their `channel_accounts` columns.)
   */
  appSecret?: string;
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
  /**
   * Foundation for metering/attribution (DOCS/archive/audits/METERING-FOUNDATION.md G3):
   * conversation identifier, when the producer already has one available at
   * publish time (e.g. an upstream chat session id). Optional — most channel
   * providers key messages by from/to, not by conversation, so this is left
   * unset unless a producer can populate it cheaply. Flows into
   * `ChannelEnvelope.data.payload.conversationId` and from there into the
   * `channel_events.conversation_id` audit column.
   */
  conversationId?: string;
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

  parseWebhook(rawBody: Record<string, unknown>): InboundMessage[];

  sendMessage(
    account: ChannelAccount,
    message: OutboundMessage
  ): Promise<SendMessageResult>;

  verifySignature(
    rawBody: Uint8Array,
    signature: string,
    secret: string
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
