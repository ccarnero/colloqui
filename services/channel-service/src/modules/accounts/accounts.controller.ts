import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { Channel } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import {
  CreateAccountDto,
  ListAccountsQueryDto,
  UpdateAccountDto,
} from "./accounts.dto";
import { AccountsService } from "./accounts.service";

/** CRUD for channel accounts (Telegram, Http, E2e-tests). */
@Controller("channels/accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: CreateAccountDto
  ) {
    // Every surviving channel is served by its own single-channel provider,
    // so the provider defaults to the channel itself — no silent fallback to
    // the decommissioned family provider that used to absorb two channels.
    const provider = dto.provider ?? dto.channel;

    return this.accounts.create(tenantId, {
      channel: dto.channel,
      provider,
      name: dto.name,
      externalId: dto.externalId,
      telegramBotToken: dto.telegramBotToken,
      accessToken: dto.accessToken,
      appSecret: dto.appSecret,
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
    @Query() query: ListAccountsQueryDto
  ) {
    return this.accounts.list(tenantId, query.channel as Channel | undefined);
  }

  @Get(":id")
  async get(@Headers(TENANT_HEADER) tenantId: string, @Param("id") id: string) {
    const account = await this.accounts.findById(tenantId, id);
    if (!account) {
      throw new NotFoundException("Account not found");
    }
    return account;
  }

  @Patch(":id")
  async update(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateAccountDto
  ) {
    const account = await this.accounts.update(tenantId, id, dto);
    if (!account) {
      throw new NotFoundException("Account not found");
    }
    return account;
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string
  ) {
    const deleted = await this.accounts.remove(tenantId, id);
    if (!deleted) {
      throw new NotFoundException("Account not found");
    }
  }
}
