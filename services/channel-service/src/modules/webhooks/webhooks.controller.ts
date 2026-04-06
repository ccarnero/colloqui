import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PinoLoggerService } from "@yoizen/observability";
import type { Channel } from "@yoizen/shared";
import { AccountsService } from "../accounts/accounts.service";
import { WebhookIngressService } from "./webhook-ingress.service";
import { MetaWebhookVerifyQueryDto } from "./meta-webhook-verify-query.dto";

@Controller("webhooks")
export class WebhooksController {
  private readonly logger = new PinoLoggerService(WebhooksController.name);

  constructor(
    private readonly accounts: AccountsService,
    private readonly webhookIngress: WebhookIngressService,
  ) {}

  /**
   * Meta webhook verification (GET).
   * Returns hub.challenge if verify_token matches.
   */
  @Get(":channel/:tenantId")
  async verify(
    @Param("channel") channel: string,
    @Param("tenantId") tenantId: string,
    @Query() query: MetaWebhookVerifyQueryDto,
  ): Promise<string> {
    if (
      query.mode !== "subscribe" ||
      !query.verifyToken ||
      !query.challenge
    ) {
      throw new BadRequestException("Missing verification parameters");
    }

    const account = await this.accounts.findByVerifyToken(
      tenantId,
      channel as Channel,
      query.verifyToken,
    );

    if (!account) {
      this.logger.warn(
        `Webhook verification failed: invalid verify_token for tenant=${tenantId} channel=${channel}`,
      );
      throw new NotFoundException("Invalid verify token");
    }

    this.logger.log(
      `Webhook verified for tenant=${tenantId} channel=${channel} account=${account.id}`,
    );
    return query.challenge;
  }

  /**
   * Meta webhook callback (POST).
   * Verifies HMAC signature, parses messages, publishes to ingress.
   * Returns 200 immediately per Meta best practices.
   */
  @Post(":channel/:tenantId")
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param("channel") channel: string,
    @Param("tenantId") tenantId: string,
    @Req() request: RawBodyRequest<FastifyRequest>,
  ): Promise<{ status: string }> {
    return this.webhookIngress.handleMetaWebhookPost(channel, tenantId, request);
  }
}
