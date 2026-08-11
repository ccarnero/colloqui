/**
 * Channel account as returned by channel-service list/detail APIs.
 * Optional fields align with provider-specific credentials.
 *
 * The Meta-only fields (`phoneNumberId`, `wabaId`, `igUserId`, `appId`,
 * `verifyToken`) went away with the Meta channel decommission, together with
 * their `channel_accounts` columns. `appSecret` stays: it is the webhook
 * verification secret for Telegram and Http.
 */
export interface IChannelAccount {
  id: string;
  channel: string;
  provider: string;
  name: string;
  externalId: string;
  telegramBotToken?: string;
  accessToken: string;
  appSecret?: string;
  isActive: boolean;
  /** Present on list responses; omitted in dialog edit payloads. */
  createdAt?: string;
}

/** Minimal account row for dropdowns (e.g. auto-reply). */
export type IChannelAccountOption = Pick<
  IChannelAccount,
  "id" | "channel" | "name"
>;
