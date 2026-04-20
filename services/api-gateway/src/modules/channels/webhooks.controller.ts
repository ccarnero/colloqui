import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  type RawBodyRequest,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { Channel } from "@yoizen/shared";
import { Public } from "../../decorators/public.decorator";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import { WebhookVerificationQueryDto } from "./webhooks-gateway.dto";
import { WebhookIngressPublisherService } from "./webhook-ingress-publisher.service";
import { WebhookVerifyRpcClient } from "./webhook-verify-rpc.client";

/**
 * Webhook endpoints are public (no JWT, no tenant guard).
 * Tenant is resolved from the URL path parameter.
 */
@Controller("webhooks")
export class WebhooksController {
  constructor(
    private readonly publisher: WebhookIngressPublisherService,
    private readonly verifyClient: WebhookVerifyRpcClient,
  ) {}

  @Get(":channel/:tenantId")
  @Public()
  @SkipTenant()
  async verify(
    @Param("channel") channel: string,
    @Param("tenantId") tenantId: string,
    @Query() query: WebhookVerificationQueryDto,
  ): Promise<string> {
    return this.verifyClient.verify({
      tenantId,
      channel,
      query,
    });
  }

  @Post(":channel/:tenantId")
  @Public()
  @SkipTenant()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param("channel") channel: string,
    @Param("tenantId") tenantId: string,
    @Req() request: RawBodyRequest<FastifyRequest>,
  ): Promise<{ status: string }> {
    if (!Buffer.isBuffer(request.rawBody) || request.rawBody.length === 0) {
      throw new BadRequestException(
        "Missing raw request body for webhook ingress",
      );
    }

    await this.publisher.publishWebhook({
      tenantId,
      channel: channel as Channel,
      rawBody: request.rawBody,
      headers: request.headers as Record<string, unknown>,
      parsedBody: request.body,
    });

    return { status: "accepted" };
  }
}
