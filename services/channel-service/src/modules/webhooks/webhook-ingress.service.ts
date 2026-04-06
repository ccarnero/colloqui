import {
  BadRequestException,
  Injectable,
  type RawBodyRequest,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PinoLoggerService } from "@yoizen/observability";
import type { Channel, IChannelProvider, InboundMessage } from "@yoizen/shared";
import { ChannelRouter } from "../../providers/channel-router";
import { IngressService } from "../ingress/ingress.service";
import { AccountsService } from "../accounts/accounts.service";
import {
  webhookRequests,
  webhookVerificationFailures,
  ingressMessagesReceived,
} from "../ingress/ingress.metrics";

type IAccountWithSecret = Awaited<
  ReturnType<AccountsService["listActive"]>
>[number];

/** Options for webhook signature verification against active accounts. */
interface ICheckSignatureMismatchOptions {
  provider: IChannelProvider;
  request: RawBodyRequest<FastifyRequest>;
  channel: string;
  tenantId: string;
  activeAccounts: IAccountWithSecret[];
}

/**
 * Meta HMAC is computed over the exact raw bytes Meta sent. Re-serializing JSON
 * breaks verification (key order / whitespace).
 */
function getWebhookRawBodyForSignature(
  request: RawBodyRequest<FastifyRequest>,
): Buffer {
  const raw = request.rawBody;
  if (Buffer.isBuffer(raw) && raw.length > 0) {
    return raw;
  }
  throw new BadRequestException(
    "Missing raw request body; webhook signature verification requires raw bytes",
  );
}

@Injectable()
export class WebhookIngressService {
  private readonly logger = new PinoLoggerService(WebhookIngressService.name);

  constructor(
    private readonly router: ChannelRouter,
    private readonly ingress: IngressService,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Meta webhook callback: validates channel, verifies HMAC, parses messages,
   * schedules ingress processing. Returns 200 immediately per Meta best practices.
   */
  async handleMetaWebhookPost(
    channel: string,
    tenantId: string,
    request: RawBodyRequest<FastifyRequest>,
  ): Promise<{ status: string }> {
    const channelType = channel as Channel;
    webhookRequests.add(1, { channel, tenant: tenantId });
    const provider = this.router.get(channelType);
    if (!provider) {
      throw new BadRequestException(`Unsupported channel: ${channel}`);
    }

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

    const signatureMismatch = this.checkSignatureMismatch({
      provider,
      request,
      channel,
      tenantId,
      activeAccounts,
    });
    if (signatureMismatch !== null) {
      return signatureMismatch;
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

    this.scheduleIngress({
      tenantId,
      channelType,
      provider,
      account: activeAccounts[0],
      messages,
    });
    return { status: "accepted" };
  }

  private checkSignatureMismatch(
    options: ICheckSignatureMismatchOptions,
  ): { status: string } | null {
    const { provider, request, channel, tenantId, activeAccounts } = options;
    const signature = provider.signatureHeader
      ? (request.headers[provider.signatureHeader] as string | undefined)
      : undefined;

    const rawBodyForSignature = signature
      ? getWebhookRawBodyForSignature(request)
      : undefined;

    const verified = activeAccounts.some((account) => {
      if (!account.appSecret || !signature || !rawBodyForSignature) return false;
      return provider.verifySignature(
        rawBodyForSignature,
        signature,
        account.appSecret,
      );
    });

    if (signature && !verified) {
      webhookVerificationFailures.add(1, { channel, tenant: tenantId });
      this.logger.warn(
        `Webhook signature verification failed for tenant=${tenantId} channel=${channel}`,
      );
      return { status: "signature_mismatch" };
    }
    return null;
  }

  private scheduleIngress(options: {
    tenantId: string;
    channelType: Channel;
    provider: IChannelProvider;
    account: IAccountWithSecret;
    messages: InboundMessage[];
  }): void {
    const { tenantId, channelType, provider, account, messages } = options;
    setImmediate(() => {
      this.ingress
        .processInbound({
          tenantId,
          channel: channelType,
          provider: provider.provider,
          accountId: account.id,
          messages,
        })
        .catch((err) => {
          this.logger.error(
            `Ingress processing failed: ${err instanceof Error ? err.message : err}`,
          );
        });
    });
  }
}
