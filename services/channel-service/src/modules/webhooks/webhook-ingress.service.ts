import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { Channel, IChannelProvider, InboundMessage } from "@yoizen/shared";
import { WEBHOOK_SECRET_HEADERS_SET } from "@yoizen/shared";
import { ChannelRouter } from "../../providers/channel-router";
import { AccountsService } from "../accounts/accounts.service";
import {
  ingressMessagesReceived,
  webhookRequests,
  webhookVerificationFailures,
} from "../ingress/ingress.metrics";
import { IngressService } from "../ingress/ingress.service";

type IAccountWithSecret = Awaited<
  ReturnType<AccountsService["listActive"]>
>[number];

@Injectable()
export class WebhookIngressService {
  private readonly logger = new PinoLoggerService(WebhookIngressService.name);

  constructor(
    private readonly router: ChannelRouter,
    private readonly ingress: IngressService,
    private readonly accounts: AccountsService
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
    causal?: {
      correlationId?: string;
      causationId?: string | null;
      depth?: number;
    },
    instance?: string
  ): Promise<{ status: string }> {
    const channelType = channel as Channel;
    webhookRequests.add(1, { channel, tenant: tenantId });
    const provider = this.router.get(channelType);
    if (!provider) {
      this.logger.warn(
        `Unsupported webhook channel=${channel} tenant=${tenantId}`
      );
      return { status: "unsupported_channel" };
    }

    const activeAccounts = await this.accounts.listActive(
      tenantId,
      channelType
    );
    if (activeAccounts.length === 0) {
      this.logger.warn(
        `No active accounts for tenant=${tenantId} channel=${channel}`
      );
      return { status: "no_active_accounts" };
    }

    const body = this.toBody(parsedBody);
    if (body === null) {
      this.logger.warn(
        `Webhook payload is not a JSON object for tenant=${tenantId} channel=${channel}`
      );
      return { status: "invalid_payload" };
    }

    const signature = provider.signatureHeader
      ? this.readHeader(headers, provider.signatureHeader)
      : undefined;

    const resolution = this.resolveAccount({
      provider,
      rawBody,
      signature,
      channel: channelType,
      tenantId,
      activeAccounts,
      instance,
    });
    if ("status" in resolution) {
      return resolution;
    }
    const account = resolution.account;

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
      account,
      messages,
      causal,
      // Same allowlist the signature check above read (api-gateway filtered
      // it against WEBHOOK_FORWARDED_HEADERS, the consumer lowercased the
      // keys), minus the verification-secret subset: resolveAccount has
      // already used those to authenticate, and stage-2 `data.headers` must
      // never carry a secret (envelope.md §4.1, decided 2026-08-01).
      webhookHeaders: this.stripSecretHeaders(headers),
    });
    return { status: "accepted" };
  }

  /**
   * Picks the account for ingress: the signature header is the ONLY signal
   * that identifies which account delivered the update (the payload of every
   * surviving channel carries no account id), so a missing/empty secret is
   * treated as `signature_mismatch` — never a silent fallback to the first
   * active account, which would be a spoofing vector.
   *
   * The legacy first-active-account fallback and the payload-metadata
   * disambiguation (`phone_number_id` / `ig_user_id`) went away with the Meta
   * provider family: no surviving channel can identify an account from the
   * body, so an ambiguous verification is a rejection.
   */
  private resolveAccount(options: {
    provider: IChannelProvider;
    rawBody: Buffer;
    signature: string | undefined;
    channel: Channel;
    tenantId: string;
    activeAccounts: IAccountWithSecret[];
    /** Account `externalId` from the instance-addressed ingress URL, if any. */
    instance?: string;
  }): { account: IAccountWithSecret } | { status: string } {
    const { provider, rawBody, signature, channel, tenantId, instance } =
      options;

    /**
     * Instance-addressed ingress (`/api/webhooks/<channel>/<tenant>/<instance>`):
     * the URL path segment is the account `externalId`. Narrow the candidate set
     * to that single account so the URL selects *which* account — the token is
     * still verified below (defense in depth; the URL is not the credential).
     * An unknown instance is rejected rather than falling back to token-only
     * matching across all accounts.
     */
    let activeAccounts = options.activeAccounts;
    if (instance !== undefined && instance.length > 0) {
      activeAccounts = activeAccounts.filter(
        (account) => account.externalId === instance
      );
      if (activeAccounts.length === 0) {
        webhookVerificationFailures.add(1, { channel, tenant: tenantId });
        this.logger.warn(
          `Webhook rejected: no active ${channel} account with externalId='${instance}' (tenant=${tenantId})`
        );
        return { status: "unknown_instance" };
      }
    }

    if (!signature) {
      webhookVerificationFailures.add(1, { channel, tenant: tenantId });
      this.logger.warn(
        `${channel} webhook rejected: missing ${provider.signatureHeader ?? "signature header"} (tenant=${tenantId})`
      );
      return { status: "signature_mismatch" };
    }

    const verified = activeAccounts.filter((account) => {
      const secret = account.appSecret;
      return (
        typeof secret === "string" &&
        provider.verifySignature(rawBody, signature, secret)
      );
    });

    if (verified.length === 0) {
      webhookVerificationFailures.add(1, { channel, tenant: tenantId });
      this.logger.warn(
        `Webhook signature verification failed for tenant=${tenantId} channel=${channel}`
      );
      return { status: "signature_mismatch" };
    }

    if (verified.length === 1) {
      return { account: verified[0] };
    }

    webhookVerificationFailures.add(1, { channel, tenant: tenantId });
    this.logger.warn(
      `Ambiguous webhook: ${verified.length} accounts verify for tenant=${tenantId} channel=${channel}`
    );
    return { status: "signature_mismatch" };
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
    headerName: string
  ): string | undefined {
    const direct = headers[headerName];
    if (direct) {
      return direct;
    }
    return headers[headerName.toLowerCase()];
  }

  /**
   * Removes the verification-secret headers (WEBHOOK_SECRET_HEADERS) once the
   * signature check has consumed them. Keys arrive lowercased from the
   * webhook consumer, but the strip is case-insensitive anyway so a future
   * caller cannot leak a secret by casing.
   */
  private stripSecretHeaders(
    headers: Record<string, string>
  ): Record<string, string> {
    const forwarded: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (WEBHOOK_SECRET_HEADERS_SET.has(key.toLowerCase())) {
        continue;
      }
      forwarded[key] = value;
    }
    return forwarded;
  }

  private scheduleIngress(options: {
    tenantId: string;
    channelType: Channel;
    provider: IChannelProvider;
    account: IAccountWithSecret;
    messages: InboundMessage[];
    causal?: {
      correlationId?: string;
      causationId?: string | null;
      depth?: number;
    };
    /**
     * Stage-1 header allowlist minus the verification-secret subset,
     * forwarded to `data.headers` (envelope.md §4.1).
     */
    webhookHeaders?: Record<string, string>;
  }): void {
    const {
      tenantId,
      channelType,
      provider,
      account,
      messages,
      causal,
      webhookHeaders,
    } = options;
    setImmediate(() => {
      this.ingress
        .processInbound({
          tenantId,
          channel: channelType,
          provider: provider.provider,
          accountId: account.id,
          messages,
          ...causal,
          webhookHeaders,
        })
        .catch((err) => {
          this.logger.error(
            `Ingress processing failed: ${err instanceof Error ? err.message : err}`
          );
        });
    });
  }
}
