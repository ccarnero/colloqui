import {
  Injectable,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type {
  Channel,
  IChannelProvider,
  InboundMessage,
} from "@yoizen/shared";
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

function extractMetaPhoneNumberId(
  body: Record<string, unknown>,
): string | undefined {
  const entry = body.entry;
  if (!Array.isArray(entry) || entry.length === 0) return undefined;
  const first = entry[0] as Record<string, unknown>;
  const changes = first.changes;
  if (!Array.isArray(changes) || changes.length === 0) return undefined;
  const value = (changes[0] as { value?: { metadata?: { phone_number_id?: string } } })
    ?.value;
  return value?.metadata?.phone_number_id;
}

/** Best-effort Instagram business account id from Graph webhook JSON. */
function extractInstagramBusinessIdHint(
  body: Record<string, unknown>,
): string | undefined {
  const entry = body.entry;
  if (!Array.isArray(entry) || entry.length === 0) return undefined;
  for (const ent of entry) {
    const e = ent as Record<string, unknown>;
    const messaging = e.messaging;
    if (Array.isArray(messaging)) {
      for (const m of messaging) {
        const mid = (m as { recipient?: { id?: string } })?.recipient?.id;
        if (typeof mid === "string") return mid;
      }
    }
  }
  return undefined;
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
    causal?: { correlationId?: string; causationId?: string | null; depth?: number },
    instance?: string,
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

    const body = this.toBody(parsedBody);
    if (body === null) {
      this.logger.warn(
        `Webhook payload is not a JSON object for tenant=${tenantId} channel=${channel}`,
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
      body,
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
    });
    return { status: "accepted" };
  }

  /**
   * Picks the account for ingress: verifies HMAC when a signature header is
   * present; disambiguates multiple Meta accounts via payload metadata.
   *
   * For Telegram and Http, the signature header is the ONLY signal that
   * identifies which account delivered the update (the payload carries no
   * account id), so a missing/empty secret is treated as `signature_mismatch`
   * to avoid silent routing to the first active account (which would also
   * be a spoofing vector). WhatsApp/Instagram keep the legacy fallback
   * because they can disambiguate via `phone_number_id` / `ig_user_id`.
   */
  private resolveAccount(options: {
    provider: IChannelProvider;
    rawBody: Buffer;
    signature: string | undefined;
    channel: Channel;
    tenantId: string;
    activeAccounts: IAccountWithSecret[];
    body: Record<string, unknown>;
    /** Account `externalId` from the instance-addressed ingress URL, if any. */
    instance?: string;
  }):
    | { account: IAccountWithSecret }
    | { status: string } {
    const {
      provider,
      rawBody,
      signature,
      channel,
      tenantId,
      body,
      instance,
    } = options;

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
        (account) => account.externalId === instance,
      );
      if (activeAccounts.length === 0) {
        webhookVerificationFailures.add(1, { channel, tenant: tenantId });
        this.logger.warn(
          `Webhook rejected: no active ${channel} account with externalId='${instance}' (tenant=${tenantId})`,
        );
        return { status: "unknown_instance" };
      }
    }

    if (!signature) {
      if (channel === "telegram" || channel === "http") {
        webhookVerificationFailures.add(1, { channel, tenant: tenantId });
        this.logger.warn(
          `${channel} webhook rejected: missing ${provider.signatureHeader} (tenant=${tenantId})`,
        );
        return { status: "signature_mismatch" };
      }
      return { account: activeAccounts[0] };
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
        `Webhook signature verification failed for tenant=${tenantId} channel=${channel}`,
      );
      return { status: "signature_mismatch" };
    }

    if (verified.length === 1) {
      return { account: verified[0] };
    }

    if (channel === "whatsapp") {
      const phoneId = extractMetaPhoneNumberId(body);
      if (phoneId) {
        const match = verified.find((a) => a.phoneNumberId === phoneId);
        if (match) return { account: match };
      }
    }

    if (channel === "instagram") {
      const igFromBody = extractInstagramBusinessIdHint(body);
      if (igFromBody) {
        const match = verified.find((a) => a.igUserId === igFromBody);
        if (match) return { account: match };
      }
    }

    webhookVerificationFailures.add(1, { channel, tenant: tenantId });
    this.logger.warn(
      `Ambiguous webhook: ${verified.length} accounts verify for tenant=${tenantId} channel=${channel}`,
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
    causal?: { correlationId?: string; causationId?: string | null; depth?: number };
  }): void {
    const { tenantId, channelType, provider, account, messages, causal } = options;
    setImmediate(() => {
      this.ingress
        .processInbound({
          tenantId,
          channel: channelType,
          provider: provider.provider,
          accountId: account.id,
          messages,
          ...causal,
        })
        .catch((err) => {
          this.logger.error(
            `Ingress processing failed: ${err instanceof Error ? err.message : err}`,
          );
        });
    });
  }
}
