import type { Channel, ChannelAccount } from "@yoizen/shared";

export const ACCOUNTS_REPOSITORY = Symbol("ACCOUNTS_REPOSITORY");

/**
 * Mutable channel_accounts columns for PATCH-style updates.
 *
 * The Meta-only `app_id` / `verify_token` columns were dropped with the Meta
 * channel decommission; `app_secret` stays — it is the webhook verification
 * secret for Telegram and Http.
 */
export interface IAccountUpdatePatch {
  name?: string;
  accessToken?: string;
  appSecret?: string | null;
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

/**
 * One `channel_accounts` row. Mirrors `CHANNEL_ACCOUNTS_SCHEMA_SQL` — the
 * Meta-only columns (`phone_number_id`, `waba_id`, `ig_user_id`, `app_id`,
 * `verify_token`) are gone with the Meta channel decommission.
 */
export interface IAccountRow {
  id: string;
  channel: string;
  provider: string;
  name: string;
  external_id: string;
  telegram_bot_token: string | null;
  access_token: string;
  app_secret: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IAccountsRepository {
  insertAccount(params: IInsertAccountParams): Promise<IAccountRow[]>;
  listByTenant(tenantId: string, channel?: Channel): Promise<IAccountRow[]>;
  listActiveByChannel(
    tenantId: string,
    channel: Channel
  ): Promise<IAccountRow[]>;
  findById(tenantId: string, accountId: string): Promise<IAccountRow[]>;
  updateAccount(
    tenantId: string,
    accountId: string,
    data: IAccountUpdatePatch
  ): Promise<IAccountRow[]>;
  deleteAccount(
    tenantId: string,
    accountId: string
  ): Promise<{ count: number }>;
}
