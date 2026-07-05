/**
 * `@yoizen/platform-sdk/channels` — the `channels` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  ChannelCallOptions,
  ChannelsClient,
  ChannelsClientDeps,
} from "./client.js";
export { createChannelsClient } from "./client.js";
export type {
  AutoReplyRule,
  Channel,
  ChannelAccount,
  ChannelProvider,
  CreateAutoReplyRuleInput,
  CreateChannelAccountInput,
  ListAutoReplyRulesParams,
  ListChannelAccountsParams,
  ListUsageParams,
  ListUsageTotalsParams,
  RefreshAccountTokenResult,
  SendChannelMessageInput,
  SendChannelMessageResult,
  StreamInspectionMode,
  StreamMessage,
  StreamMessagesParams,
  StreamSummary,
  UpdateChannelAccountInput,
  UsageBucket,
  UsageBucketRow,
  UsageDirection,
  UsageSummary,
  UsageSummaryByChannelEntry,
  UsageTotalsRow,
} from "./types.js";
