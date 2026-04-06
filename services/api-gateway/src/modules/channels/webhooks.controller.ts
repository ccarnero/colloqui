import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { Public } from "../../decorators/public.decorator";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import { ChannelsProxyService } from "./channels-proxy.service";
import {
  WebhookVerificationQueryDto,
  WebhookInboundBodyDto,
} from "./webhooks-gateway.dto";

/**
 * Webhook endpoints are public (no JWT, no tenant guard).
 * Tenant is resolved from the URL path parameter.
 */
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly proxy: ChannelsProxyService) {}

  @Get(":channel/:tenantId")
  @Public()
  @SkipTenant()
  async verify(
    @Param("channel") channel: string,
    @Param("tenantId") tenantId: string,
    @Query() query: WebhookVerificationQueryDto,
  ): Promise<object> {
    const qs: Record<string, string | undefined> = {
      "hub.mode": query["hub.mode"],
      "hub.verify_token": query["hub.verify_token"],
      "hub.challenge": query["hub.challenge"],
    };

    return this.proxy.proxy({
      method: "GET",
      path: `/webhooks/${encodeURIComponent(channel)}/${encodeURIComponent(tenantId)}`,
      tenantId,
      query: qs,
    });
  }

  @Post(":channel/:tenantId")
  @Public()
  @SkipTenant()
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async receive(
    @Param("channel") channel: string,
    @Param("tenantId") tenantId: string,
    @Body() body: WebhookInboundBodyDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/webhooks/${encodeURIComponent(channel)}/${encodeURIComponent(tenantId)}`,
      tenantId,
      body: body as unknown as Record<string, unknown>,
    });
  }
}
