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
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";

@Controller("channels")
export class ChannelsController {
  constructor(
    private readonly proxy: ChannelsProxyService,
    private readonly channelStream: ChannelStreamService,
  ) {}

  @Post("accounts")
  @HttpCode(HttpStatus.CREATED)
  async createAccount(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    return this.proxy.proxy(
      "POST",
      "/channels/accounts",
      req[REQUEST_TENANT_KEY] as string,
      undefined,
      body,
    );
  }

  @Get("accounts")
  async listAccounts(
    @Req() req: Record<string, unknown>,
    @Query("channel") channel?: string,
  ) {
    return this.proxy.proxy(
      "GET",
      "/channels/accounts",
      req[REQUEST_TENANT_KEY] as string,
      { channel },
    );
  }

  @Get("accounts/:id")
  async getAccount(
    @Req() req: Record<string, unknown>,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/channels/accounts/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY] as string,
    );
  }

  @Patch("accounts/:id")
  async updateAccount(
    @Req() req: Record<string, unknown>,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.proxy.proxy(
      "PATCH",
      `/channels/accounts/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY] as string,
      undefined,
      body,
    );
  }

  @Delete("accounts/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAccount(
    @Req() req: Record<string, unknown>,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "DELETE",
      `/channels/accounts/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY] as string,
    );
  }

  @Sse("stream")
  stream(
    @Req() req: Record<string, unknown>,
    @Query("kinds") kinds?: string,
  ): Observable<MessageEvent> {
    const tenantId = req[REQUEST_TENANT_KEY] as string;
    const kindList = kinds
      ? (kinds.split(",").filter((k) => k.length > 0) as MessageKind[])
      : [];
    return this.channelStream
      .streamChannelEvents(tenantId, kindList)
      .pipe(
        map(
          (event) =>
            ({ data: event.data }) as MessageEvent,
        ),
      );
  }

  @Post(":accountId/messages")
  async sendMessage(
    @Req() req: Record<string, unknown>,
    @Param("accountId") accountId: string,
    @Body() body: unknown,
  ) {
    return this.proxy.proxy(
      "POST",
      `/channels/${encodeURIComponent(accountId)}/messages`,
      req[REQUEST_TENANT_KEY] as string,
      undefined,
      body,
    );
  }

  @Post("auto-reply")
  @HttpCode(HttpStatus.CREATED)
  async createAutoReplyRule(
    @Req() req: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return this.proxy.proxy(
      "POST",
      "/channels/auto-reply",
      req[REQUEST_TENANT_KEY] as string,
      undefined,
      body,
    );
  }

  @Get("auto-reply")
  async listAutoReplyRules(
    @Req() req: Record<string, unknown>,
    @Query("accountId") accountId?: string,
  ) {
    return this.proxy.proxy(
      "GET",
      "/channels/auto-reply",
      req[REQUEST_TENANT_KEY] as string,
      { accountId },
    );
  }

  @Delete("auto-reply/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAutoReplyRule(
    @Req() req: Record<string, unknown>,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "DELETE",
      `/channels/auto-reply/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY] as string,
    );
  }
}
