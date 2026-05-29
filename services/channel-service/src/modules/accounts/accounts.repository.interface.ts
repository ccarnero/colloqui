import type { Channel, ChannelAccount } from "@yoizen/shared";

export const ACCOUNTS_REPOSITORY = Symbol("ACCOUNTS_REPOSITORY");

/** Mutable channel_accounts columns for PATCH-style updates. */
export interface IAccountUpdatePatch {
  name?: string;
  accessToken?: string;
  appId?: string | null;
  appSecret?: string | null;
  verifyToken?: string | null;
  isActive?: boolean;
}

/** Parameters for inserting a channel account row. */
export interface IInsertAccountParams {
  readonly id: string;
  /** Used only to resolve the tenant pool; not stored. */
  readonly tenantId: string;
  readonly data: Omit<
    ChannelAccount,
    "id" | "tenantId" | "createdAt" | "updatedAt"
  >;
  readonly appSecret: string | null;
}

export interface IAccountRow {
  id: string;
  channel: string;
  provider: string;
  name: string;
  external_id: string;
  phone_number_id: string | null;
  waba_id: string | null;
  ig_user_id: string | null;
  telegram_bot_token: string | null;
  access_token: string;
  app_id: string | null;
  app_secret: string | null;
  verify_token: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IAccountsRepository {
  insertAccount(params: IInsertAccountParams): Promise<IAccountRow[]>;
  listByTenant(tenantId: string, channel?: Channel): Promise<IAccountRow[]>;
  listActiveByChannel(tenantId: string, channel: Channel): Promise<IAccountRow[]>;
  findById(tenantId: string, accountId: string): Promise<IAccountRow[]>;
  findByVerifyToken(
    tenantId: string,
    channel: Channel,
    verifyToken: string,
  ): Promise<IAccountRow[]>;
  updateAccount(
    tenantId: string,
    accountId: string,
    data: IAccountUpdatePatch,
  ): Promise<IAccountRow[]>;
  deleteAccount(tenantId: string, accountId: string): Promise<{ count: number }>;
}
