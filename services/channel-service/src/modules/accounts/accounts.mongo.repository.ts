import { Inject, Injectable } from "@nestjs/common";
import type { Db, TenantMongoConnectionManager } from "@yoizen/database";
import type { Channel } from "@yoizen/shared";
import { ChannelTenantConnectionManager } from "../../providers/channel-tenant-connection-manager";
import type {
  IAccountRow,
  IAccountUpdatePatch,
  IAccountsRepository,
  IInsertAccountParams,
} from "./accounts.repository.interface";

interface IChannelAccountDoc {
  readonly _id: string;
  readonly channel: string;
  readonly provider: string;
  readonly name: string;
  readonly external_id: string;
  readonly phone_number_id: string | null;
  readonly waba_id: string | null;
  readonly ig_user_id: string | null;
  readonly telegram_bot_token: string | null;
  readonly access_token: string;
  readonly app_id: string | null;
  readonly app_secret: string | null;
  readonly verify_token: string | null;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function docToRow(doc: IChannelAccountDoc): IAccountRow {
  return {
    id: String(doc._id),
    channel: doc.channel,
    provider: doc.provider,
    name: doc.name,
    external_id: doc.external_id,
    phone_number_id: doc.phone_number_id,
    waba_id: doc.waba_id,
    ig_user_id: doc.ig_user_id,
    telegram_bot_token: doc.telegram_bot_token,
    access_token: doc.access_token,
    app_id: doc.app_id,
    app_secret: doc.app_secret,
    verify_token: doc.verify_token,
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
      phone_number_id: data.phoneNumberId ?? null,
      waba_id: data.wabaId ?? null,
      ig_user_id: data.igUserId ?? null,
      telegram_bot_token: data.telegramBotToken ?? null,
      access_token: data.accessToken,
      app_id: data.appId ?? null,
      app_secret: appSecret,
      verify_token: data.verifyToken ?? null,
      is_active: data.isActive,
      created_at: now,
      updated_at: now,
    };
    await db
      .collection<IChannelAccountDoc>("channel_accounts")
      .insertOne(doc);
    return [docToRow(doc)];
  }

  async listByTenant(
    tenantId: string,
    channel?: Channel,
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
    channel: Channel,
  ): Promise<IAccountRow[]> {
    const db = await this.dbFor(tenantId);
    const docs = await db
      .collection<IChannelAccountDoc>("channel_accounts")
      .find({ channel, is_active: true })
      .sort({ created_at: 1 })
      .toArray();
    return docs.map(docToRow);
  }

  async findById(
    tenantId: string,
    accountId: string,
  ): Promise<IAccountRow[]> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<IChannelAccountDoc>("channel_accounts")
      .findOne({ _id: accountId });
    return doc ? [docToRow(doc)] : [];
  }

  async findByVerifyToken(
    tenantId: string,
    channel: Channel,
    verifyToken: string,
  ): Promise<IAccountRow[]> {
    const db = await this.dbFor(tenantId);
    const doc = await db
      .collection<IChannelAccountDoc>("channel_accounts")
      .findOne({ channel, verify_token: verifyToken, is_active: true });
    return doc ? [docToRow(doc)] : [];
  }

  /**
   * Applies a partial update; empty patch returns current row via findById (no UPDATE).
   */
  async updateAccount(
    tenantId: string,
    accountId: string,
    data: IAccountUpdatePatch,
  ): Promise<IAccountRow[]> {
    const sets: Record<string, unknown> = {};

    if (data.name !== undefined) sets.name = data.name;
    if (data.accessToken !== undefined) sets.access_token = data.accessToken;
    if (data.appId !== undefined) sets.app_id = data.appId;
    if (data.appSecret !== undefined) sets.app_secret = data.appSecret;
    if (data.verifyToken !== undefined) sets.verify_token = data.verifyToken;
    if (data.isActive !== undefined) sets.is_active = data.isActive;

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
        { returnDocument: "after" },
      );
    return result ? [docToRow(result)] : [];
  }

  async deleteAccount(
    tenantId: string,
    accountId: string,
  ): Promise<{ count: number }> {
    const db = await this.dbFor(tenantId);
    const result = await db
      .collection<IChannelAccountDoc>("channel_accounts")
      .deleteOne({ _id: accountId });
    return { count: result.deletedCount };
  }
}
