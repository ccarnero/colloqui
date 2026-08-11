import { Inject, Injectable } from "@nestjs/common";
import type { Db, TenantMongoConnectionManager } from "@yoizen/database";
import type { Channel } from "@yoizen/shared";
import { ChannelTenantConnectionManager } from "../../providers/channel-tenant-connection-manager";
import type {
  IAccountRow,
  IAccountsRepository,
  IAccountUpdatePatch,
  IInsertAccountParams,
} from "./accounts.repository.interface";

/**
 * Mongo mirror of `channel_accounts`. The Meta-only fields
 * (`phone_number_id`, `waba_id`, `ig_user_id`, `app_id`, `verify_token`) died
 * with the Meta channel decommission; `app_secret` stays — it is the webhook
 * verification secret for Telegram and Http.
 */
interface IChannelAccountDoc {
  readonly _id: string;
  readonly channel: string;
  readonly provider: string;
  readonly name: string;
  readonly external_id: string;
  readonly telegram_bot_token: string | null;
  readonly access_token: string;
  readonly app_secret: string | null;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value ?? "");
}

function docToRow(doc: IChannelAccountDoc): IAccountRow {
  return {
    id: String(doc._id),
    channel: doc.channel,
    provider: doc.provider,
    name: doc.name,
    external_id: doc.external_id,
    telegram_bot_token: doc.telegram_bot_token,
    access_token: doc.access_token,
    app_secret: doc.app_secret,
    is_active: doc.is_active,
    created_at: toIso(doc.created_at),
    updated_at: toIso(doc.updated_at),
  };
}

@Injectable()
export class AccountsMongoRepository implements IAccountsRepository {
  constructor(
    @Inject(ChannelTenantConnectionManager)
    private readonly tenantDb: TenantMongoConnectionManager,
  ) {}

  private async dbFor(tenantId: string): Promise<Db> {
    return this.tenantDb.ensureSchema(tenantId);
  }

  async insertAccount(params: IInsertAccountParams): Promise<IAccountRow[]> {
    const { id, tenantId, data, appSecret } = params;
    const db = await this.dbFor(tenantId);
    const now = new Date();
    const doc: IChannelAccountDoc = {
      _id: id,
      channel: data.channel,
      provider: data.provider,
      name: data.name,
      external_id: data.externalId,
      telegram_bot_token: data.telegramBotToken ?? null,
      access_token: data.accessToken,
      app_secret: appSecret,
      is_active: data.isActive,
      created_at: now,
      updated_at: now,
    };
    await db.collection<IChannelAccountDoc>("channel_accounts").insertOne(doc);
    return [docToRow(doc)];
  }

  async listByTenant(
    tenantId: string,
    channel?: Channel
  ): Promise<IAccountRow[]> {
    const db = await this.dbFor(tenantId);
    const filter = channel ? { channel } : {};
    const docs = await db
      .collection<IChannelAccountDoc>("channel_accounts")
      .find(filter)
      .sort({ created_at: -1 })
      .toArray();
    return docs.map(docToRow);
  }

  async listActiveByChannel(
    tenantId: string,
    channel: Channel
  ): Promise<IAccountRow[]> {
    const db = await this.dbFor(tenantId);
    const docs = await db
      .collection<IChannelAccountDoc>("channel_accounts")
      .find({ channel, is_active: true })
      .sort({ created_at: 1 })
      .toArray();
    return docs.map(docToRow);
  }

  async findById(tenantId: string, accountId: string): Promise<IAccountRow[]> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<IChannelAccountDoc>("channel_accounts")
      .findOne({ _id: accountId });
    return doc ? [docToRow(doc)] : [];
  }

  /**
   * Applies a partial update; empty patch returns current row via findById (no UPDATE).
   */
  async updateAccount(
    tenantId: string,
    accountId: string,
    data: IAccountUpdatePatch
  ): Promise<IAccountRow[]> {
    const sets: Record<string, unknown> = {};

    if (data.name !== undefined) {
      sets.name = data.name;
    }
    if (data.accessToken !== undefined) {
      sets.access_token = data.accessToken;
    }
    if (data.appSecret !== undefined) {
      sets.app_secret = data.appSecret;
    }
    if (data.isActive !== undefined) {
      sets.is_active = data.isActive;
    }

    if (Object.keys(sets).length === 0) {
      return this.findById(tenantId, accountId);
    }

    sets.updated_at = new Date();
    const db = await this.dbFor(tenantId);
    const result = await db
      .collection<IChannelAccountDoc>("channel_accounts")
      .findOneAndUpdate(
        { _id: accountId },
        { $set: sets },
        { returnDocument: "after" }
      );
    return result ? [docToRow(result)] : [];
  }

  async deleteAccount(
    tenantId: string,
    accountId: string
  ): Promise<{ count: number }> {
    const db = await this.dbFor(tenantId);
    const result = await db
      .collection<IChannelAccountDoc>("channel_accounts")
      .deleteOne({ _id: accountId });
    return { count: result.deletedCount };
  }
}
