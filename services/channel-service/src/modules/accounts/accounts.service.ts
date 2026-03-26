import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Sql } from "postgres";
import type { Channel, ChannelAccount } from "@yoizen/shared";
import { POSTGRES_SQL } from "../../providers/postgres.provider";

interface AccountRow {
  id: string;
  tenant_id: string;
  channel: string;
  provider: string;
  name: string;
  external_id: string;
  phone_number_id: string | null;
  waba_id: string | null;
  ig_user_id: string | null;
  access_token: string;
  app_id: string | null;
  app_secret: string | null;
  verify_token: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function mapRow(row: AccountRow): ChannelAccount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    channel: row.channel as Channel,
    provider: row.provider as "meta",
    name: row.name,
    externalId: row.external_id,
    phoneNumberId: row.phone_number_id ?? undefined,
    wabaId: row.waba_id ?? undefined,
    igUserId: row.ig_user_id ?? undefined,
    accessToken: row.access_token,
    appId: row.app_id ?? undefined,
    appSecret: row.app_secret ?? undefined,
    verifyToken: row.verify_token ?? undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async create(
    tenantId: string,
    data: Omit<ChannelAccount, "id" | "tenantId" | "createdAt" | "updatedAt">,
  ): Promise<ChannelAccount> {
    const id = crypto.randomUUID();
    const rows = await this.sql<AccountRow[]>`
      INSERT INTO channel_accounts (
        id, tenant_id, channel, provider, name, external_id,
        phone_number_id, waba_id, ig_user_id, access_token,
        app_id, app_secret, verify_token, is_active
      ) VALUES (
        ${id}, ${tenantId}, ${data.channel}, ${data.provider}, ${data.name},
        ${data.externalId}, ${data.phoneNumberId ?? null},
        ${data.wabaId ?? null}, ${data.igUserId ?? null},
        ${data.accessToken}, ${data.appId ?? null},
        ${data.appSecret ?? null}, ${data.verifyToken ?? null},
        ${data.isActive}
      )
      RETURNING *
    `;

    return mapRow(rows[0]);
  }

  async list(
    tenantId: string,
    channel?: Channel,
  ): Promise<ChannelAccount[]> {
    const rows = channel
      ? await this.sql<AccountRow[]>`
          SELECT * FROM channel_accounts
          WHERE tenant_id = ${tenantId} AND channel = ${channel}
          ORDER BY created_at DESC
        `
      : await this.sql<AccountRow[]>`
          SELECT * FROM channel_accounts
          WHERE tenant_id = ${tenantId}
          ORDER BY created_at DESC
        `;

    return rows.map(mapRow);
  }

  async listActive(
    tenantId: string,
    channel: Channel,
  ): Promise<ChannelAccount[]> {
    const rows = await this.sql<AccountRow[]>`
      SELECT * FROM channel_accounts
      WHERE tenant_id = ${tenantId}
        AND channel = ${channel}
        AND is_active = true
      ORDER BY created_at ASC
    `;

    return rows.map(mapRow);
  }

  async findById(
    tenantId: string,
    accountId: string,
  ): Promise<ChannelAccount | null> {
    const rows = await this.sql<AccountRow[]>`
      SELECT * FROM channel_accounts
      WHERE id = ${accountId} AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findByVerifyToken(
    tenantId: string,
    channel: Channel,
    verifyToken: string,
  ): Promise<ChannelAccount | null> {
    const rows = await this.sql<AccountRow[]>`
      SELECT * FROM channel_accounts
      WHERE tenant_id = ${tenantId}
        AND channel = ${channel}
        AND verify_token = ${verifyToken}
        AND is_active = true
      LIMIT 1
    `;

    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async update(
    tenantId: string,
    accountId: string,
    data: Partial<Pick<
      ChannelAccount,
      "name" | "accessToken" | "appId" | "appSecret" | "verifyToken" | "isActive"
    >>,
  ): Promise<ChannelAccount | null> {
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

    const setClause = sets
      .map((col, i) => `${col} = $${i + 3}`)
      .join(", ");

    const query = `
      UPDATE channel_accounts
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `;

    const params = [accountId, tenantId, ...values] as (
      | string
      | boolean
      | number
      | null
    )[];
    const rows = await this.sql.unsafe<AccountRow[]>(query, params);

    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async remove(tenantId: string, accountId: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM channel_accounts
      WHERE id = ${accountId} AND tenant_id = ${tenantId}
    `;

    return result.count > 0;
  }
}
