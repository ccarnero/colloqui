import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Sse,
  HttpCode,
  HttpStatus,
  type MessageEvent,
} from "@nestjs/common";
import { Observable, map } from "rxjs";
import type { MessageKind } from "@yoizen/shared";
import { ChannelsProxyService } from "./channels-proxy.service";
import { ChannelStreamService } from "./channel-stream.service";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import {
  CreateAutoReplyRuleBodyDto,
  CreateChannelAccountBodyDto,
  ListAutoReplyRulesQueryDto,
  ListChannelAccountsQueryDto,
  ChannelStreamQueryDto,
  SendChannelMessageBodyDto,
  UpdateChannelAccountBodyDto,
} from "./channels-gateway.dto";

@Controller("channels")
export class ChannelsController {
  constructor(
    private readonly proxy: ChannelsProxyService,
    private readonly channelStream: ChannelStreamService,
  ) {}

  @Post("accounts")
  @HttpCode(HttpStatus.CREATED)
  async createAccount(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateChannelAccountBodyDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: "/channels/accounts",
      tenantId: req.tenantId,
      body: body as unknown as Record<string, unknown>,
    });
  }

  @Get("accounts")
  async listAccounts(
    @Req() req: ITenantScopedRequest,
    @Query() query: ListChannelAccountsQueryDto,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/channels/accounts",
      tenantId: req.tenantId,
      query: { channel: query.channel },
    });
  }

  @Get("accounts/:id")
  async getAccount(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/channels/accounts/${encodeURIComponent(id)}`,
      tenantId: req.tenantId,
    });
  }

  @Patch("accounts/:id")
  async updateAccount(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateChannelAccountBodyDto,
  ) {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/channels/accounts/${encodeURIComponent(id)}`,
      tenantId: req.tenantId,
      body: body as unknown as Record<string, unknown>,
    });
  }

  @Delete("accounts/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAccount(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/channels/accounts/${encodeURIComponent(id)}`,
      tenantId: req.tenantId,
    });
  }

  @Sse("stream")
  stream(
    @Req() req: ITenantScopedRequest,
    @Query() query: ChannelStreamQueryDto,
  ): Observable<MessageEvent> {
    const tenantId = req.tenantId;
    const kinds = query.kinds;
    const kindList = kinds
      ? (kinds.split(",").filter((k) => k.length > 0) as MessageKind[])
      : [];
    return this.channelStream
      .streamChannelEvents(tenantId, kindList)
      .pipe(map((event) => ({ data: event.data }) as MessageEvent));
  }

  @Post(":accountId/messages")
  async sendMessage(
    @Req() req: ITenantScopedRequest,
    @Param("accountId") accountId: string,
    @Body() body: SendChannelMessageBodyDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: `/channels/${encodeURIComponent(accountId)}/messages`,
      tenantId: req.tenantId,
      body: body as unknown as Record<string, unknown>,
    });
  }

  @Post("auto-reply")
  @HttpCode(HttpStatus.CREATED)
  async createAutoReplyRule(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateAutoReplyRuleBodyDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: "/channels/auto-reply",
      tenantId: req.tenantId,
      body: body as unknown as Record<string, unknown>,
    });
  }

  @Get("auto-reply")
  async listAutoReplyRules(
    @Req() req: ITenantScopedRequest,
    @Query() query: ListAutoReplyRulesQueryDto,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/channels/auto-reply",
      tenantId: req.tenantId,
      query: { accountId: query.accountId },
    });
  }

  @Delete("auto-reply/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAutoReplyRule(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/channels/auto-reply/${encodeURIComponent(id)}`,
      tenantId: req.tenantId,
    });
  }
}
