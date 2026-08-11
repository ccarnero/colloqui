import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { Channel, ChannelAccount, ChannelProvider } from "@yoizen/shared";
import { channelServiceConfig } from "../../config";
import { TelegramProvider } from "../../providers/telegram/telegram.provider";
import {
  ACCOUNTS_REPOSITORY,
  type IAccountRow,
  type IAccountsRepository,
  type IAccountUpdatePatch,
} from "./accounts.repository.interface";

/**
 * Row → `ChannelAccount`. The Meta-only columns (`phone_number_id`,
 * `waba_id`, `ig_user_id`, `app_id`, `verify_token`) are gone: no surviving
 * channel wrote or read them, so they were dropped from the DDL, from
 * `IAccountRow` and from `ChannelAccount` with the contract shrink.
 * `app_secret` stays — Telegram and Http use it as their webhook
 * verification secret.
 */
function mapRow(row: IAccountRow, tenantId: string): ChannelAccount {
  return {
    id: row.id,
    tenantId,
    channel: row.channel as Channel,
    provider: row.provider as ChannelProvider,
    name: row.name,
    externalId: row.external_id,
    telegramBotToken: row.telegram_bot_token ?? undefined,
    accessToken: row.access_token,
    appSecret: row.app_secret ?? undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class AccountsService {
  private readonly logger = new PinoLoggerService(AccountsService.name);

  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly accountsRepository: IAccountsRepository,
    private readonly telegramProvider: TelegramProvider,
  ) {}

  async create(
    tenantId: string,
    data: Omit<ChannelAccount, "id" | "tenantId" | "createdAt" | "updatedAt">
  ): Promise<ChannelAccount> {
    const id = crypto.randomUUID();

    let appSecret = data.appSecret ?? null;
    if (
      (data.channel === "telegram" || data.channel === "http") &&
      !appSecret
    ) {
      appSecret = crypto.randomUUID().replace(/-/g, "");
    }

    const rows = await this.accountsRepository.insertAccount({
      id,
      tenantId,
      data,
      appSecret,
    });

    const account = mapRow(rows[0], tenantId);

    if (account.channel === "telegram" && account.isActive) {
      await this.registerTelegramWebhook(account);
    }

    return account;
  }

  async list(tenantId: string, channel?: Channel): Promise<ChannelAccount[]> {
    const rows = await this.accountsRepository.listByTenant(tenantId, channel);

    return rows.map((r) => mapRow(r, tenantId));
  }

  async listActive(
    tenantId: string,
    channel: Channel
  ): Promise<ChannelAccount[]> {
    const rows = await this.accountsRepository.listActiveByChannel(
      tenantId,
      channel
    );

    return rows.map((r) => mapRow(r, tenantId));
  }

  async findById(
    tenantId: string,
    accountId: string
  ): Promise<ChannelAccount | null> {
    const rows = await this.accountsRepository.findById(tenantId, accountId);

    return rows.length > 0 ? mapRow(rows[0], tenantId) : null;
  }

  async update(
    tenantId: string,
    accountId: string,
    data: Partial<
      Pick<ChannelAccount, "name" | "accessToken" | "appSecret" | "isActive">
    >
  ): Promise<ChannelAccount | null> {
    const patch: IAccountUpdatePatch = {};
    if (data.name !== undefined) {
      patch.name = data.name;
    }
    if (data.accessToken !== undefined) {
      patch.accessToken = data.accessToken;
    }
    if (data.appSecret !== undefined) {
      patch.appSecret = data.appSecret;
    }
    if (data.isActive !== undefined) {
      patch.isActive = data.isActive;
    }

    if (Object.keys(patch).length === 0) {
      return this.findById(tenantId, accountId);
    }

    const rows = await this.accountsRepository.updateAccount(
      tenantId,
      accountId,
      patch
    );

    return rows.length > 0 ? mapRow(rows[0], tenantId) : null;
  }

  async remove(tenantId: string, accountId: string): Promise<boolean> {
    const result = await this.accountsRepository.deleteAccount(
      tenantId,
      accountId
    );

    return result.count > 0;
  }

  private async registerTelegramWebhook(
    account: ChannelAccount
  ): Promise<void> {
    const botToken = account.telegramBotToken ?? account.accessToken;
    const baseUrl = channelServiceConfig.channelServicePublicUrl;
    const webhookUrl = `${baseUrl}/webhooks/telegram/${account.tenantId}`;

    try {
      const result = await this.telegramProvider.registerWebhook(
        botToken,
        webhookUrl,
        account.appSecret ?? ""
      );

      if (result.ok) {
        this.logger.log(
          `Telegram webhook registered for account=${account.id}`
        );
      } else {
        this.logger.warn(
          `Telegram webhook registration failed for account=${account.id}: ${result.description}`
        );
      }
    } catch (err) {
      this.logger.error(
        `Telegram webhook registration error: ${err instanceof Error ? err.message : err}`
      );
    }
  }
}
