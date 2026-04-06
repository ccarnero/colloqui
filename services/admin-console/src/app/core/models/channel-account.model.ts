/**
 * Channel account as returned by channel-service list/detail APIs.
 * Optional fields align with provider-specific credentials.
 */
export interface IChannelAccount {
  id: string;
  channel: string;
  provider: string;
  name: string;
  externalId: string;
  phoneNumberId?: string;
  wabaId?: string;
  telegramBotToken?: string;
  accessToken: string;
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
  isActive: boolean;
  /** Present on list responses; omitted in dialog edit payloads. */
  createdAt?: string;
}

/** Minimal account row for dropdowns (e.g. auto-reply). */
export type IChannelAccountOption = Pick<
  IChannelAccount,
  "id" | "channel" | "name"
>;
