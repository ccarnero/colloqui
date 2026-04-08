import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import type { Channel } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import { AccountsService } from "./accounts.service";
import {
  CreateAccountDto,
  ListAccountsQueryDto,
  type RefreshTokenResponseDto,
  UpdateAccountDto,
} from "./accounts.dto";

/** CRUD for channel accounts (WhatsApp, Instagram, Telegram). */
@Controller("channels/accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: CreateAccountDto,
  ) {
    const provider =
      dto.provider ?? (dto.channel === "telegram" ? "telegram" : "meta");

    return this.accounts.create(tenantId, {
      channel: dto.channel,
      provider,
      name: dto.name,
      externalId: dto.externalId,
      phoneNumberId: dto.phoneNumberId,
      wabaId: dto.wabaId,
      igUserId: dto.igUserId,
      telegramBotToken: dto.telegramBotToken,
      accessToken: dto.accessToken,
      appId: dto.appId,
      appSecret: dto.appSecret,
      verifyToken: dto.verifyToken,
      isActive: dto.isActive ?? true,
    });
  }

  /**
   * Lists channel accounts, optionally filtered by validated channel enum.
   *
   * @param tenantId  Resolved from `x-yoizen-tenant`.
   * @param query     Optional `channel` filter.
   */
  @Get()
  async list(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: ListAccountsQueryDto,
  ) {
    return this.accounts.list(tenantId, query.channel as Channel | undefined);
  }

  @Get(":id")
  async get(@Headers(TENANT_HEADER) tenantId: string, @Param("id") id: string) {
    const account = await this.accounts.findById(tenantId, id);
    if (!account) throw new NotFoundException("Account not found");
    return account;
  }

  @Patch(":id")
  async update(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    const account = await this.accounts.update(tenantId, id, dto);
    if (!account) throw new NotFoundException("Account not found");
    return account;
  }

  /**
   * Exchanges the current Meta access token for a long-lived one (~60 days).
   *
   * @param tenantId Resolved from `x-yoizen-tenant`.
   * @param id       Account ID whose token should be refreshed.
   * @returns The new token metadata (token is masked in response).
   */
  @Post(":id/refresh-token")
  async refreshToken(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
  ): Promise<RefreshTokenResponseDto> {
    const result = await this.accounts.refreshMetaToken(tenantId, id);

    const masked =
      result.accessToken.length > 12
        ? `${result.accessToken.slice(0, 6)}..${result.accessToken.slice(-4)}`
        : "***";

    return {
      accessToken: masked,
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
    };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
  ) {
    const deleted = await this.accounts.remove(tenantId, id);
    if (!deleted) throw new NotFoundException("Account not found");
  }
}
