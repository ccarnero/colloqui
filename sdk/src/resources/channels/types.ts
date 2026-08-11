/**
 * Request/response types for the `channels` resource, hand-typed against the
 * REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2):
 *
 * - `services/api-gateway/src/modules/channels/channels.controller.ts` +
 *   `channels-gateway.dto.ts` define the gateway-side routes and validation.
 * - `services/channel-service/src/modules/accounts/accounts.controller.ts` +
 *   `accounts.service.ts` + `accounts.dto.ts` define account CRUD.
 * - `services/channel-service/src/modules/egress/egress.controller.ts` +
 *   `egress.dto.ts` define the outbound message send.
 * - `services/channel-service/src/modules/auto-reply/auto-reply.controller.ts`
 *   + `auto-reply.dto.ts` define auto-reply rule CRUD.
 * - `services/channel-service/src/modules/streams/streams.controller.ts` +
 *   `streams.dto.ts` define the NATS stream inspection endpoints.
 * - `services/channel-service/src/modules/usage/usage.controller.ts` +
 *   `usage.dto.ts` define the usage query endpoints.
 * - `packages/shared/src/channel.interfaces.ts` owns `ChannelAccount`,
 *   `SendMessageResult`, `AutoReplyRule`. The SDK is a standalone published
 *   package and does not depend on internal workspace packages, so these are
 *   hand-mirrored here rather than imported.
 *
 * `GET /channels/usage/summary` (24h rolling summary, `usage.service.ts`
 * `getUsageSummary`) is now proxied by the gateway's `ChannelsController`
 * (`@Get("usage/summary")`, declared before `@Get("usage/totals")` so Nest
 * matches it before the more specific sibling route). The route is live:
 * `sdk/test/e2e/channels.e2e.ts` calls `usageSummary()` against the dev
 * cluster and asserts the aggregate shape (`windowHours === 24`, a
 * `byChannel` array, a numeric `total.ingress`). See `usageSummary()`.
 */

/**
 * BREAKING (Meta channel decommission): the `whatsapp` / `instagram` channel
 * tokens, the `meta` provider, the Meta-only account fields
 * (`phoneNumberId`, `wabaId`, `igUserId`, `appId`, `verifyToken`) and
 * `refreshAccountToken()` are gone — the endpoints and DB columns behind them
 * no longer exist. `appSecret` stays: it is the webhook verification secret
 * for Telegram (`x-telegram-bot-api-secret-token`) and Http
 * (`x-http-channel-token`).
 */
export type Channel = "telegram" | "http" | "e2e-tests";
export type ChannelProvider = "telegram" | "http" | "e2e-tests";

/** Response shape for account create/list/get/update (`ChannelAccount` in `@yoizen/shared`). */
export interface ChannelAccount {
  id: string;
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  name: string;
  externalId: string;
  telegramBotToken?: string;
  accessToken: string;
  appSecret?: string;
  isActive: boolean;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

/** `POST /channels/accounts` body (mirrors `CreateAccountDto`). */
export interface CreateChannelAccountInput {
  channel: Channel;
  provider?: ChannelProvider;
  name: string;
  externalId: string;
  telegramBotToken?: string;
  accessToken: string;
  appSecret?: string;
  isActive?: boolean;
}

/** `PATCH /channels/accounts/:id` body (mirrors `UpdateAccountDto`). */
export interface UpdateChannelAccountInput {
  name?: string;
  accessToken?: string;
  appSecret?: string;
  isActive?: boolean;
}

export interface ListChannelAccountsParams {
  channel?: Channel;
}

/** `POST /channels/:accountId/messages` body (mirrors `SendMessageDto`). */
export interface SendChannelMessageInput {
  to: string;
  type: "text" | "template" | "image" | "document";
  text?: string;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: Record<string, unknown>[];
  mediaUrl?: string;
  caption?: string;
}

/** Response shape for the egress send (`SendMessageResult` in `@yoizen/shared`). */
export interface SendChannelMessageResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
}

/** `POST /channels/auto-reply` body (mirrors `CreateAutoReplyRuleDto`). */
export interface CreateAutoReplyRuleInput {
  accountId: string;
  /** Auto-reply is channel-agnostic: downstream validates the full `Channel` union. */
  channel: Channel;
  triggerPattern: string;
  replyText: string;
}

/** Response shape for auto-reply create/list (`AutoReplyRule` in `@yoizen/shared`). */
export interface AutoReplyRule {
  id: string;
  tenantId: string;
  accountId: string;
  channel: Channel;
  triggerPattern: string;
  replyText: string;
  isActive: boolean;
}

export interface ListAutoReplyRulesParams {
  accountId?: string;
}

export type UsageDirection = "ingress" | "egress" | "dlq";
export type UsageBucket = "hour" | "day";

/** Query for `GET /channels/usage` (mirrors `UsageQueryGatewayDto`). */
export interface ListUsageParams {
  /** ISO-8601 start of range. */
  from: string;
  /** ISO-8601 end of range. */
  to: string;
  bucket?: UsageBucket;
  accountId?: string;
  channel?: string;
  direction?: UsageDirection;
}

/** One row of `GET /channels/usage` (`{ items: IUsageBucketRow[] }`). */
export interface UsageBucketRow {
  bucket: string;
  accountId: string;
  channel: string;
  direction: UsageDirection;
  events: number;
}

/** Query for `GET /channels/usage/totals` (mirrors `UsageTotalsQueryGatewayDto`). */
export interface ListUsageTotalsParams {
  from: string;
  to: string;
  accountId?: string;
  channel?: string;
}

/** One row of `GET /channels/usage/totals` (`{ items: IUsageTotalsRow[] }`). */
export interface UsageTotalsRow {
  direction: UsageDirection;
  events: number;
  firstTs: string | null;
  lastTs: string | null;
}

/** Row of `GET /channels/streams` (`{ items: IStreamSummary[] }`). */
export interface StreamSummary {
  name: string;
  kind: "ingress" | "dlq";
  subjects: string[];
  messages: number;
  bytes: number;
  firstSeq: number;
  lastSeq: number;
  firstTs: string | null;
  lastTs: string | null;
  maxAgeNs: number;
  maxBytes: number;
  consumerCount: number;
}

export type StreamInspectionMode = "last-per-subject" | "tail";

/** Query for `GET /channels/streams/:key/messages` (mirrors `StreamMessagesQueryGatewayDto`). */
export interface StreamMessagesParams {
  subject?: string;
  accountId?: string;
  /** 1-200, API-enforced. */
  limit?: number;
  mode?: StreamInspectionMode;
}

/** Row of `GET /channels/streams/:key/messages` (`{ items: IStreamMessage[] }`). */
export interface StreamMessage {
  seq: number;
  subject: string;
  ts: string;
  headers: Record<string, string>;
  data: unknown;
  size: number;
}

/** Per-channel breakdown row in {@link UsageSummary} (`IUsageSummaryByChannelEntry`). */
export interface UsageSummaryByChannelEntry {
  channel: string;
  ingress: number;
  egress: number;
  dlq: number;
}

/**
 * Response shape for `GET /channels/usage/summary` (`IUsageSummaryResponse`,
 * `channel-service`'s `UsageService.getUsageSummary` — a fixed 24h rolling
 * window, not caller-configurable).
 */
export interface UsageSummary {
  windowHours: 24;
  total: {
    ingress: number;
    egress: number;
    dlq: number;
  };
  byChannel: UsageSummaryByChannelEntry[];
}
