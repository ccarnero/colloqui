import { Inject, Injectable } from "@nestjs/common";
import type { Sql, TenantConnectionManager } from "@yoizen/database";
import type { Channel } from "@yoizen/shared";
import { ChannelTenantConnectionManager } from "../../providers/channel-tenant-connection-manager";
import type {
  IAccountRow,
  IAccountsRepository,
  IAccountUpdatePatch,
  IInsertAccountParams,
} from "./accounts.repository.interface";

@Injectable()
export class AccountsPostgresRepository implements IAccountsRepository {
  constructor(
    @Inject(ChannelTenantConnectionManager)
    private readonly tenantSql: TenantConnectionManager,
  ) {}

  private async sqlFor(tenantId: string): Promise<Sql> {
    return this.tenantSql.ensureSchema(tenantId);
  }

  async insertAccount(params: IInsertAccountParams): Promise<IAccountRow[]> {
    const { id, tenantId, data, appSecret } = params;
    const sql = await this.sqlFor(tenantId);
    // `provider` is always written explicitly: the column lost its Meta
    // DEFAULT with the Meta channel decommission (channel-schema.ts).
    return sql<IAccountRow[]>`
      INSERT INTO channel_accounts (
        id, channel, provider, name, external_id,
        telegram_bot_token, access_token, app_secret, is_active
      ) VALUES (
        ${id}, ${data.channel}, ${data.provider}, ${data.name},
        ${data.externalId}, ${data.telegramBotToken ?? null},
        ${data.accessToken}, ${appSecret}, ${data.isActive}
      )
      RETURNING *
    `;
  }

  async listByTenant(
    tenantId: string,
    channel?: Channel
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
    channel: Channel
  ): Promise<IAccountRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IAccountRow[]>`
      SELECT * FROM channel_accounts
      WHERE channel = ${channel}
        AND is_active = true
      ORDER BY created_at ASC
    `;
  }

  async findById(tenantId: string, accountId: string): Promise<IAccountRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IAccountRow[]>`
      SELECT * FROM channel_accounts
      WHERE id = ${accountId}
      LIMIT 1
    `;
  }

  /**
   * Applies a partial update; empty patch returns current row via findById (no UPDATE).
   */
  async updateAccount(
    tenantId: string,
    accountId: string,
    data: IAccountUpdatePatch
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
    if (data.appSecret !== undefined) {
      sets.push("app_secret");
      values.push(data.appSecret);
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
    accountId: string
  ): Promise<{ count: number }> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      DELETE FROM channel_accounts
      WHERE id = ${accountId}
    `;
  }
}
