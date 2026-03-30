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
import { CreateAccountDto, UpdateAccountDto } from "./accounts.dto";

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

  @Get()
  async list(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query("channel") channel?: string,
  ) {
    return this.accounts.list(
      tenantId,
      channel as Channel | undefined,
    );
  }

  @Get(":id")
  async get(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
  ) {
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
