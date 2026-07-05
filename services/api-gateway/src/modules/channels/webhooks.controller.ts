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
import type { IYoizenRequest } from "../../types/yoizen-request";
import { Public } from "../../decorators/public.decorator";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import { WebhookVerificationQueryDto } from "./webhooks-gateway.dto";
import { WebhookIngressPublisherService } from "./webhook-ingress-publisher.service";
import { WebhookVerifyRpcClient } from "./webhook-verify-rpc.client";
import { ApiTags } from "@nestjs/swagger";

/**
 * Webhook endpoints are public (no JWT, no tenant guard).
 * Tenant is resolved from the URL path parameter.
 */
@ApiTags("webhooks")
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
    return this.ingest(channel, tenantId, undefined, request);
  }

  /**
   * Instance-addressed ingress: `<instance>` is the channel account's
   * `externalId`, so a tenant can expose one URL per configured account
   * (`/api/webhooks/<channel>/<tenant>/<instance>`). The URL selects *which*
   * account; the token header (e.g. `x-http-channel-token`) still
   * authenticates downstream — the URL is not the credential.
   */
  @Post(":channel/:tenantId/:instance")
  @Public()
  @SkipTenant()
  @HttpCode(HttpStatus.OK)
  async receiveInstance(
    @Param("channel") channel: string,
    @Param("tenantId") tenantId: string,
    @Param("instance") instance: string,
    @Req() request: RawBodyRequest<FastifyRequest>,
  ): Promise<{ status: string }> {
    return this.ingest(channel, tenantId, instance, request);
  }

  private async ingest(
    channel: string,
    tenantId: string,
    instance: string | undefined,
    request: RawBodyRequest<FastifyRequest>,
  ): Promise<{ status: string }> {
    if (!Buffer.isBuffer(request.rawBody) || request.rawBody.length === 0) {
      throw new BadRequestException(
        "Missing raw request body for webhook ingress",
      );
    }

    await this.publisher.publishWebhook({
      tenantId,
      channel: channel as Channel,
      ...(instance !== undefined && { instance }),
      rawBody: request.rawBody,
      headers: request.headers as Record<string, unknown>,
      parsedBody: request.body,
      request: request as unknown as IYoizenRequest,
    });

    return { status: "accepted" };
  }
}
