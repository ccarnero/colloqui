import type { Paginated } from "../../core/pagination.js";
import { paginate, toSinglePage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  AutoReplyRule,
  ChannelAccount,
  CreateAutoReplyRuleInput,
  CreateChannelAccountInput,
  ListAutoReplyRulesParams,
  ListChannelAccountsParams,
  ListUsageParams,
  ListUsageTotalsParams,
  SendChannelMessageInput,
  SendChannelMessageResult,
  StreamMessage,
  StreamMessagesParams,
  StreamSummary,
  UpdateChannelAccountInput,
  UsageBucketRow,
  UsageSummary,
  UsageTotalsRow,
} from "./types.js";

export interface ChannelsClientDeps {
  transport: Transport;
}

export interface ChannelCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface ChannelsClient {
  /** `POST /channels/accounts` — create a channel account. */
  createAccount(
    input: CreateChannelAccountInput,
    opts?: ChannelCallOptions
  ): Promise<ChannelAccount>;
  /**
   * `GET /channels/accounts` — bare array today (no pagination convention,
   * see `src/core/pagination.ts`), degraded to a single page.
   */
  listAccounts(params?: ListChannelAccountsParams): Paginated<ChannelAccount>;
  /** `GET /channels/accounts/:id`. */
  getAccount(id: string, opts?: ChannelCallOptions): Promise<ChannelAccount>;
  /** `PATCH /channels/accounts/:id`. */
  updateAccount(
    id: string,
    input: UpdateChannelAccountInput,
    opts?: ChannelCallOptions
  ): Promise<ChannelAccount>;
  /** `DELETE /channels/accounts/:id`; resolves on 204. */
  removeAccount(id: string, opts?: ChannelCallOptions): Promise<void>;
  /** `POST /channels/:accountId/messages` — egress send. */
  sendMessage(
    accountId: string,
    input: SendChannelMessageInput,
    opts?: ChannelCallOptions
  ): Promise<SendChannelMessageResult>;
  /** `POST /channels/auto-reply` — create an auto-reply rule. */
  createAutoReplyRule(
    input: CreateAutoReplyRuleInput,
    opts?: ChannelCallOptions
  ): Promise<AutoReplyRule>;
  /** `GET /channels/auto-reply` — bare array, degraded to a single page. */
  listAutoReplyRules(
    params?: ListAutoReplyRulesParams
  ): Paginated<AutoReplyRule>;
  /** `DELETE /channels/auto-reply/:id`; resolves on 204. */
  removeAutoReplyRule(id: string, opts?: ChannelCallOptions): Promise<void>;
  /** `GET /channels/streams` — `{ items }` envelope with no `total`, degraded to a single page. */
  listStreams(): Paginated<StreamSummary>;
  /** `GET /channels/streams/:key/messages` — `{ items }` envelope with no `total`, degraded to a single page. */
  streamMessages(
    key: string,
    params?: StreamMessagesParams
  ): Paginated<StreamMessage>;
  /** `GET /channels/usage` — `{ items }` envelope with no `total`, degraded to a single page. */
  listUsage(params: ListUsageParams): Paginated<UsageBucketRow>;
  /** `GET /channels/usage/totals` — `{ items }` envelope with no `total`, degraded to a single page. */
  listUsageTotals(params: ListUsageTotalsParams): Paginated<UsageTotalsRow>;
  /**
   * `GET /channels/usage/summary` — 24h rolling total + per-channel
   * breakdown. The gateway route is live on the dev cluster and covered by
   * `test/e2e/channels.e2e.ts` — see `types.ts`.
   */
  usageSummary(opts?: ChannelCallOptions): Promise<UsageSummary>;
}

/**
 * Creates the `channels` namespace client. Follows the `workflows` reference
 * implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md "Resource
 * clients".
 */
export function createChannelsClient({
  transport,
}: ChannelsClientDeps): ChannelsClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  function toQuery(
    params: Record<string, string | number | undefined>
  ): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    return qs.length > 0 ? `?${qs}` : "";
  }

  async function createAccount(
    input: CreateChannelAccountInput,
    opts: ChannelCallOptions = {}
  ): Promise<ChannelAccount> {
    const { body } = await transport.request<ChannelAccount>({
      path: "/channels/accounts",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function listAccounts(
    params: ListChannelAccountsParams = {}
  ): Paginated<ChannelAccount> {
    return paginate<ChannelAccount>(async () => {
      const { body } = await transport.request<ChannelAccount[]>({
        path: `/channels/accounts${toQuery({ channel: params.channel })}`,
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function getAccount(
    id: string,
    opts: ChannelCallOptions = {}
  ): Promise<ChannelAccount> {
    const { body } = await transport.request<ChannelAccount>({
      path: `/channels/accounts/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function updateAccount(
    id: string,
    input: UpdateChannelAccountInput,
    opts: ChannelCallOptions = {}
  ): Promise<ChannelAccount> {
    const { body } = await transport.request<ChannelAccount>({
      path: `/channels/accounts/${encodePath(id)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function removeAccount(
    id: string,
    opts: ChannelCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/channels/accounts/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function sendMessage(
    accountId: string,
    input: SendChannelMessageInput,
    opts: ChannelCallOptions = {}
  ): Promise<SendChannelMessageResult> {
    const { body } = await transport.request<SendChannelMessageResult>({
      path: `/channels/${encodePath(accountId)}/messages`,
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function createAutoReplyRule(
    input: CreateAutoReplyRuleInput,
    opts: ChannelCallOptions = {}
  ): Promise<AutoReplyRule> {
    const { body } = await transport.request<AutoReplyRule>({
      path: "/channels/auto-reply",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function listAutoReplyRules(
    params: ListAutoReplyRulesParams = {}
  ): Paginated<AutoReplyRule> {
    return paginate<AutoReplyRule>(async () => {
      const { body } = await transport.request<AutoReplyRule[]>({
        path: `/channels/auto-reply${toQuery({ accountId: params.accountId })}`,
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function removeAutoReplyRule(
    id: string,
    opts: ChannelCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/channels/auto-reply/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  function listStreams(): Paginated<StreamSummary> {
    return paginate<StreamSummary>(async () => {
      const { body } = await transport.request<{ items: StreamSummary[] }>({
        path: "/channels/streams",
        method: "GET",
      });
      return toSinglePage(body.items);
    });
  }

  function streamMessages(
    key: string,
    params: StreamMessagesParams = {}
  ): Paginated<StreamMessage> {
    return paginate<StreamMessage>(async () => {
      const { body } = await transport.request<{ items: StreamMessage[] }>({
        path: `/channels/streams/${encodePath(key)}/messages${toQuery({
          subject: params.subject,
          accountId: params.accountId,
          limit: params.limit,
          mode: params.mode,
        })}`,
        method: "GET",
      });
      return toSinglePage(body.items);
    });
  }

  function listUsage(params: ListUsageParams): Paginated<UsageBucketRow> {
    return paginate<UsageBucketRow>(async () => {
      const { body } = await transport.request<{ items: UsageBucketRow[] }>({
        path: `/channels/usage${toQuery({
          from: params.from,
          to: params.to,
          bucket: params.bucket,
          accountId: params.accountId,
          channel: params.channel,
          direction: params.direction,
        })}`,
        method: "GET",
      });
      return toSinglePage(body.items);
    });
  }

  function listUsageTotals(
    params: ListUsageTotalsParams
  ): Paginated<UsageTotalsRow> {
    return paginate<UsageTotalsRow>(async () => {
      const { body } = await transport.request<{ items: UsageTotalsRow[] }>({
        path: `/channels/usage/totals${toQuery({
          from: params.from,
          to: params.to,
          accountId: params.accountId,
          channel: params.channel,
        })}`,
        method: "GET",
      });
      return toSinglePage(body.items);
    });
  }

  async function usageSummary(
    opts: ChannelCallOptions = {}
  ): Promise<UsageSummary> {
    const { body } = await transport.request<UsageSummary>({
      path: "/channels/usage/summary",
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  return {
    createAccount,
    listAccounts,
    getAccount,
    updateAccount,
    removeAccount,
    sendMessage,
    createAutoReplyRule,
    listAutoReplyRules,
    removeAutoReplyRule,
    listStreams,
    streamMessages,
    listUsage,
    listUsageTotals,
    usageSummary,
  };
}
