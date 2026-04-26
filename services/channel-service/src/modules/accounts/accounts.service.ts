import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Channel, ChannelAccount, ChannelProvider } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { channelServiceConfig } from "../../config";
import {
  exchangeForLongLivedToken,
  type ITokenExchangeResult,
} from "../../providers/meta/meta-token";
import { TelegramProvider } from "../../providers/telegram/telegram.provider";
import {
  AccountsRepository,
  type IAccountRow,
  type IAccountUpdatePatch,
} from "./accounts.repository";

function mapRow(row: IAccountRow, tenantId: string): ChannelAccount {
  return {
    id: row.id,
    tenantId,
    channel: row.channel as Channel,
    provider: row.provider as ChannelProvider,
    name: row.name,
    externalId: row.external_id,
    phoneNumberId: row.phone_number_id ?? undefined,
    wabaId: row.waba_id ?? undefined,
    igUserId: row.ig_user_id ?? undefined,
    telegramBotToken: row.telegram_bot_token ?? undefined,
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
  private readonly logger = new PinoLoggerService(AccountsService.name);

  constructor(
    private readonly accountsRepository: AccountsRepository,
    private readonly telegramProvider: TelegramProvider,
  ) {}

  async create(
    tenantId: string,
    data: Omit<ChannelAccount, "id" | "tenantId" | "createdAt" | "updatedAt">,
  ): Promise<ChannelAccount> {
    const id = crypto.randomUUID();

    let appSecret = data.appSecret ?? null;
    if (data.channel === "telegram" && !appSecret) {
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
    channel: Channel,
  ): Promise<ChannelAccount[]> {
    const rows = await this.accountsRepository.listActiveByChannel(
      tenantId,
      channel,
    );

    return rows.map((r) => mapRow(r, tenantId));
  }

  async findById(
    tenantId: string,
    accountId: string,
  ): Promise<ChannelAccount | null> {
    const rows = await this.accountsRepository.findById(tenantId, accountId);

    return rows.length > 0 ? mapRow(rows[0], tenantId) : null;
  }

  async findByVerifyToken(
    tenantId: string,
    channel: Channel,
    verifyToken: string,
  ): Promise<ChannelAccount | null> {
    const rows = await this.accountsRepository.findByVerifyToken(
      tenantId,
      channel,
      verifyToken,
    );

    return rows.length > 0 ? mapRow(rows[0], tenantId) : null;
  }

  async update(
    tenantId: string,
    accountId: string,
    data: Partial<
      Pick<
        ChannelAccount,
        | "name"
        | "accessToken"
        | "appId"
        | "appSecret"
        | "verifyToken"
        | "isActive"
      >
    >,
  ): Promise<ChannelAccount | null> {
    const patch: IAccountUpdatePatch = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.accessToken !== undefined) patch.accessToken = data.accessToken;
    if (data.appId !== undefined) patch.appId = data.appId;
    if (data.appSecret !== undefined) patch.appSecret = data.appSecret;
    if (data.verifyToken !== undefined) patch.verifyToken = data.verifyToken;
    if (data.isActive !== undefined) patch.isActive = data.isActive;

    if (Object.keys(patch).length === 0) {
      return this.findById(tenantId, accountId);
    }

    const rows = await this.accountsRepository.updateAccount(
      tenantId,
      accountId,
      patch,
    );

    return rows.length > 0 ? mapRow(rows[0], tenantId) : null;
  }

  async remove(tenantId: string, accountId: string): Promise<boolean> {
    const result = await this.accountsRepository.deleteAccount(
      tenantId,
      accountId,
    );

    return result.count > 0;
  }

  /**
   * Exchanges the current Meta access token for a long-lived one (~60 days)
   * and persists it on the account.
   *
   * @param tenantId  Tenant owning the account.
   * @param accountId Account whose token should be refreshed.
   * @returns The exchange result including the (masked) new token and expiry.
   */
  async refreshMetaToken(
    tenantId: string,
    accountId: string,
  ): Promise<ITokenExchangeResult> {
    const account = await this.findById(tenantId, accountId);
    if (!account) {
      throw new NotFoundException("Account not found");
    }

    if (account.provider !== "meta") {
      throw new BadRequestException(
        "Token refresh is only supported for Meta (WhatsApp/Instagram) accounts",
      );
    }

    if (!account.appId || !account.appSecret) {
      throw new BadRequestException(
        "Meta App ID and App Secret are required for token refresh",
      );
    }

    const result = await exchangeForLongLivedToken({
      currentToken: account.accessToken,
      appId: account.appId,
      appSecret: account.appSecret,
    });

    await this.update(tenantId, accountId, {
      accessToken: result.accessToken,
    });

    this.logger.log(
      `Meta token refreshed for account=${accountId}, expires_in=${result.expiresIn}s`,
    );

    return result;
  }

  private async registerTelegramWebhook(
    account: ChannelAccount,
  ): Promise<void> {
    const botToken = account.telegramBotToken ?? account.accessToken;
    const baseUrl = channelServiceConfig.channelServicePublicUrl;
    const webhookUrl = `${baseUrl}/webhooks/telegram/${account.tenantId}`;

    try {
      const result = await this.telegramProvider.registerWebhook(
        botToken,
        webhookUrl,
        account.appSecret ?? "",
      );

      if (result.ok) {
        this.logger.log(
          `Telegram webhook registered for account=${account.id}`,
        );
      } else {
        this.logger.warn(
          `Telegram webhook registration failed for account=${account.id}: ${result.description}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Telegram webhook registration error: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
