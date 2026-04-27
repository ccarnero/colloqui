import { Inject, Injectable } from "@nestjs/common";
import type { Channel, ChannelAccount } from "@yoizen/shared";
import {
  ChannelTenantConnectionManager,
  type Sql,
} from "../../providers/channel-tenant-connection-manager";

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

@Injectable()
export class AccountsRepository {
  constructor(
    @Inject(ChannelTenantConnectionManager)
    private readonly tenantSql: ChannelTenantConnectionManager,
  ) {}

  private async sqlFor(tenantId: string): Promise<Sql> {
    return this.tenantSql.ensureSchema(tenantId);
  }

  async insertAccount(params: IInsertAccountParams): Promise<IAccountRow[]> {
    const { id, tenantId, data, appSecret } = params;
    const sql = await this.sqlFor(tenantId);
    return sql<IAccountRow[]>`
      INSERT INTO channel_accounts (
        id, channel, provider, name, external_id,
        phone_number_id, waba_id, ig_user_id, telegram_bot_token,
        access_token, app_id, app_secret, verify_token, is_active
      ) VALUES (
        ${id}, ${data.channel}, ${data.provider}, ${data.name},
        ${data.externalId}, ${data.phoneNumberId ?? null},
        ${data.wabaId ?? null}, ${data.igUserId ?? null},
        ${data.telegramBotToken ?? null},
        ${data.accessToken}, ${data.appId ?? null},
        ${appSecret}, ${data.verifyToken ?? null},
        ${data.isActive}
      )
      RETURNING *
    `;
  }

  async listByTenant(
    tenantId: string,
    channel?: Channel,
  ): Promise<IAccountRow[]> {
    const sql = await this.sqlFor(tenantId);
    return channel
      ? sql<IAccountRow[]>`
          SELECT * FROM channel_accounts
          WHERE channel = ${channel}
          ORDER BY created_at DESC
        `
      : sql<IAccountRow[]>`
          SELECT * FROM channel_accounts
          ORDER BY created_at DESC
        `;
  }

  async listActiveByChannel(
    tenantId: string,
    channel: Channel,
  ): Promise<IAccountRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IAccountRow[]>`
      SELECT * FROM channel_accounts
      WHERE channel = ${channel}
        AND is_active = true
      ORDER BY created_at ASC
    `;
  }

  async findById(
    tenantId: string,
    accountId: string,
  ): Promise<IAccountRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IAccountRow[]>`
      SELECT * FROM channel_accounts
      WHERE id = ${accountId}
      LIMIT 1
    `;
  }

  async findByVerifyToken(
    tenantId: string,
    channel: Channel,
    verifyToken: string,
  ): Promise<IAccountRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IAccountRow[]>`
      SELECT * FROM channel_accounts
      WHERE channel = ${channel}
        AND verify_token = ${verifyToken}
        AND is_active = true
      LIMIT 1
    `;
  }

  /**
   * Applies a partial update; empty patch returns current row via findById (no UPDATE).
   */
  async updateAccount(
    tenantId: string,
    accountId: string,
    data: IAccountUpdatePatch,
  ): Promise<IAccountRow[]> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      sets.push("name");
      values.push(data.name);
    }
    if (data.accessToken !== undefined) {
      sets.push("access_token");
      values.push(data.accessToken);
    }
    if (data.appId !== undefined) {
      sets.push("app_id");
      values.push(data.appId);
    }
    if (data.appSecret !== undefined) {
      sets.push("app_secret");
      values.push(data.appSecret);
    }
    if (data.verifyToken !== undefined) {
      sets.push("verify_token");
      values.push(data.verifyToken);
    }
    if (data.isActive !== undefined) {
      sets.push("is_active");
      values.push(data.isActive);
    }

    if (sets.length === 0) {
      return this.findById(tenantId, accountId);
    }

    const setClause = sets.map((col, i) => `${col} = $${i + 2}`).join(", ");

    const query = `
      UPDATE channel_accounts
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const params = [accountId, ...values] as (
      | string
      | boolean
      | number
      | null
    )[];
    const sql = await this.sqlFor(tenantId);
    return sql.unsafe<IAccountRow[]>(query, params);
  }

  async deleteAccount(
    tenantId: string,
    accountId: string,
  ): Promise<{ count: number }> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      DELETE FROM channel_accounts
      WHERE id = ${accountId}
    `;
  }
}
