import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  type MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { MessageKind } from "@yoizen/shared";
import { map, type Observable } from "rxjs";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { ChannelStreamService } from "./channel-stream.service";
// biome-ignore lint/style/useImportType: used as @Body()/@Query() metatype — needed at runtime for ValidationPipe's class-validator/class-transformer reflection.
import {
  ChannelStreamQueryDto,
  CreateAutoReplyRuleBodyDto,
  CreateChannelAccountBodyDto,
  ListAutoReplyRulesQueryDto,
  ListChannelAccountsQueryDto,
  SendChannelMessageBodyDto,
  StreamMessagesQueryGatewayDto,
  UpdateChannelAccountBodyDto,
  UsageQueryGatewayDto,
  UsageTotalsQueryGatewayDto,
} from "./channels-gateway.dto";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { ChannelsProxyService } from "./channels-proxy.service";

@ApiTags("channels")
@Controller("channels")
export class ChannelsController {
  constructor(
    private readonly proxy: ChannelsProxyService,
    private readonly channelStream: ChannelStreamService
  ) {}

  @Post("accounts")
  @HttpCode(HttpStatus.CREATED)
  async createAccount(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateChannelAccountBodyDto
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
    @Query() query: ListChannelAccountsQueryDto
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/channels/accounts",
      tenantId: req.tenantId,
      query: { channel: query.channel },
    });
  }

  @Get("accounts/:id")
  async getAccount(@Req() req: ITenantScopedRequest, @Param("id") id: string) {
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
    @Body() body: UpdateChannelAccountBodyDto
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
    @Param("id") id: string
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
    @Query() query: ChannelStreamQueryDto
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
    @Body() body: SendChannelMessageBodyDto
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
    @Body() body: CreateAutoReplyRuleBodyDto
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
    @Query() query: ListAutoReplyRulesQueryDto
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/channels/auto-reply",
      tenantId: req.tenantId,
      query: { accountId: query.accountId },
    });
  }

  @Get("usage")
  async listUsage(
    @Req() req: ITenantScopedRequest,
    @Query() query: UsageQueryGatewayDto
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/channels/usage",
      tenantId: req.tenantId,
      query: query as unknown as Record<string, string | undefined>,
    });
  }

  /**
   * 24-hour rolling summary: total counts per direction + per-channel
   * breakdown. Declared before `@Get("usage/totals")` to mirror
   * channel-service's own route ordering.
   */
  @Get("usage/summary")
  async usageSummary(@Req() req: ITenantScopedRequest) {
    return this.proxy.proxy({
      method: "GET",
      path: "/channels/usage/summary",
      tenantId: req.tenantId,
    });
  }

  @Get("usage/totals")
  async usageTotals(
    @Req() req: ITenantScopedRequest,
    @Query() query: UsageTotalsQueryGatewayDto
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/channels/usage/totals",
      tenantId: req.tenantId,
      query: query as unknown as Record<string, string | undefined>,
    });
  }

  @Get("streams")
  async listStreams(@Req() req: ITenantScopedRequest) {
    return this.proxy.proxy({
      method: "GET",
      path: "/channels/streams",
      tenantId: req.tenantId,
    });
  }

  @Get("streams/:key/messages")
  async streamMessages(
    @Req() req: ITenantScopedRequest,
    @Param("key") key: string,
    @Query() query: StreamMessagesQueryGatewayDto
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/channels/streams/${encodeURIComponent(key)}/messages`,
      tenantId: req.tenantId,
      query: query as unknown as Record<string, string | undefined>,
    });
  }

  @Delete("auto-reply/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAutoReplyRule(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string
  ) {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/channels/auto-reply/${encodeURIComponent(id)}`,
      tenantId: req.tenantId,
    });
  }
}
