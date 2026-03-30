import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Public } from "../../decorators/public.decorator";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import { ChannelsProxyService } from "./channels-proxy.service";

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
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") verifyToken?: string,
    @Query("hub.challenge") challenge?: string,
  ): Promise<object> {
    const qs: Record<string, string | undefined> = {
      "hub.mode": mode,
      "hub.verify_token": verifyToken,
      "hub.challenge": challenge,
    };

    return this.proxy.proxy(
      "GET",
      `/webhooks/${encodeURIComponent(channel)}/${encodeURIComponent(tenantId)}`,
      tenantId,
      qs,
    );
  }

  @Post(":channel/:tenantId")
  @Public()
  @SkipTenant()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param("channel") channel: string,
    @Param("tenantId") tenantId: string,
    @Req() req: Record<string, unknown>,
  ): Promise<object> {
    const headers: Record<string, string> = {};
    const sigHeader = (req as { headers?: Record<string, string> }).headers?.[
      "x-hub-signature-256"
    ];
    if (sigHeader) {
      headers["x-hub-signature-256"] = sigHeader;
    }

    return this.proxy.proxy(
      "POST",
      `/webhooks/${encodeURIComponent(channel)}/${encodeURIComponent(tenantId)}`,
      tenantId,
      undefined,
      (req as { body?: unknown }).body,
    );
  }
}
