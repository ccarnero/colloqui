import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { Channel } from "@yoizen/shared";
import { ProviderRegistry } from "../../providers/meta/provider-registry";
import { IngressService } from "../ingress/ingress.service";
import { AccountsService } from "../accounts/accounts.service";
import {
  webhookRequests,
  webhookVerificationFailures,
  ingressMessagesReceived,
} from "../ingress/ingress.metrics";

@Controller("webhooks")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly ingress: IngressService,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Meta webhook verification (GET).
   * Returns hub.challenge if verify_token matches.
   */
  @Get(":channel/:tenantId")
  async verify(
    @Param("channel") channel: string,
    @Param("tenantId") tenantId: string,
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") verifyToken?: string,
    @Query("hub.challenge") challenge?: string,
  ): Promise<string> {
    if (mode !== "subscribe" || !verifyToken || !challenge) {
      throw new BadRequestException("Missing verification parameters");
    }

    const account = await this.accounts.findByVerifyToken(
      tenantId,
      channel as Channel,
      verifyToken,
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
    return challenge;
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
    @Req() request: FastifyRequest,
  ): Promise<{ status: string }> {
    const channelType = channel as Channel;
    webhookRequests.add(1, { channel, tenant: tenantId });
    const provider = this.registry.get(channelType);
    if (!provider) {
      throw new BadRequestException(`Unsupported channel: ${channel}`);
    }

    const signature =
      request.headers["x-hub-signature-256"] as string | undefined;

    const activeAccounts = await this.accounts.listActive(
      tenantId,
      channelType,
    );

    if (activeAccounts.length === 0) {
      this.logger.warn(
        `No active accounts for tenant=${tenantId} channel=${channel}`,
      );
      return { status: "no_active_accounts" };
    }

    const rawBody = Buffer.from(
      JSON.stringify(request.body),
      "utf-8",
    );

    const verified = activeAccounts.some((account) => {
      if (!account.appSecret || !signature) return false;
      return provider.verifySignature(rawBody, signature, account.appSecret);
    });

    if (signature && !verified) {
      webhookVerificationFailures.add(1, { channel, tenant: tenantId });
      this.logger.warn(
        `HMAC verification failed for tenant=${tenantId} channel=${channel}`,
      );
      return { status: "signature_mismatch" };
    }

    const body = request.body as Record<string, unknown>;
    const messages = provider.parseWebhook(body);

    if (messages.length === 0) {
      return { status: "no_messages" };
    }

    ingressMessagesReceived.add(messages.length, {
      channel,
      tenant: tenantId,
    });

    const account = activeAccounts[0];

    setImmediate(() => {
      this.ingress
        .processInbound(tenantId, channelType, "meta", account.id, messages)
        .catch((err) => {
          this.logger.error(
            `Ingress processing failed: ${err instanceof Error ? err.message : err}`,
          );
        });
    });

    return { status: "accepted" };
  }
}
