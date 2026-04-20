import {
  Injectable,
} from "@nestjs/common";
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
  headers: Record<string, string>;
  rawBody: Buffer;
  channel: string;
  tenantId: string;
  activeAccounts: IAccountWithSecret[];
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
   * Processes a webhook envelope produced by api-gateway.
   * Validates channel, verifies signature against active accounts, parses inbound
   * messages, and schedules ingress processing.
   */
  async processEnvelope(
    channel: string,
    tenantId: string,
    rawBody: Buffer,
    headers: Record<string, string>,
    parsedBody: unknown,
  ): Promise<{ status: string }> {
    const channelType = channel as Channel;
    webhookRequests.add(1, { channel, tenant: tenantId });
    const provider = this.router.get(channelType);
    if (!provider) {
      this.logger.warn(
        `Unsupported webhook channel=${channel} tenant=${tenantId}`,
      );
      return { status: "unsupported_channel" };
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
      rawBody,
      headers,
      channel,
      tenantId,
      activeAccounts,
    });
    if (signatureMismatch !== null) {
      return signatureMismatch;
    }

    const body = this.toBody(parsedBody);
    if (body === null) {
      this.logger.warn(
        `Webhook payload is not a JSON object for tenant=${tenantId} channel=${channel}`,
      );
      return { status: "invalid_payload" };
    }

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
    const { provider, headers, rawBody, channel, tenantId, activeAccounts } =
      options;
    const signature = provider.signatureHeader
      ? this.readHeader(headers, provider.signatureHeader)
      : undefined;

    const verified = activeAccounts.some((account) => {
      if (!account.appSecret || !signature) return false;
      return provider.verifySignature(
        rawBody,
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

  private toBody(parsedBody: unknown): Record<string, unknown> | null {
    if (
      typeof parsedBody === "object" &&
      parsedBody !== null &&
      !Array.isArray(parsedBody)
    ) {
      return parsedBody as Record<string, unknown>;
    }
    return null;
  }

  private readHeader(
    headers: Record<string, string>,
    headerName: string,
  ): string | undefined {
    const direct = headers[headerName];
    if (direct) return direct;
    return headers[headerName.toLowerCase()];
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
