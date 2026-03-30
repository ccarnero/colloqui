import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager } from "nats";
import { headers as natsHeaders } from "nats";
import type {
  Channel,
  ChannelProvider,
  OutboundMessage,
  SendMessageResult,
} from "@yoizen/shared";
import {
  TENANT_HEADER,
  buildChannelSubject,
  buildIngressStreamName,
  buildTenantWildcard,
} from "@yoizen/shared";
import {
  JETSTREAM_PUBLISHER,
  JETSTREAM_MANAGER,
  ensureIngressStream,
} from "../../providers/nats.provider";
import { ChannelRouter } from "../../providers/channel-router";
import { AccountsService } from "../accounts/accounts.service";
import {
  egressMessagesSent,
  egressSendFailures,
  egressSendDuration,
  egressShadowPublishFailures,
} from "./egress.metrics";

const encoder = new TextEncoder();
const ensuredStreams = new Set<string>();

@Injectable()
export class EgressService {
  private readonly logger = new Logger(EgressService.name);

  constructor(
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    private readonly router: ChannelRouter,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Sends a message via the appropriate channel provider, then
   * shadow-publishes a `sent.v1` event to JetStream.
   */
  async send(
    tenantId: string,
    accountId: string,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const account = await this.accounts.findById(tenantId, accountId);
    if (!account) {
      throw new NotFoundException(
        `Account '${accountId}' not found for tenant '${tenantId}'`,
      );
    }

    const provider = this.router.getOrThrow(account.channel);
    const attrs = { channel: account.channel, tenant: tenantId };
    const start = performance.now();
    const result = await provider.sendMessage(account, message);
    egressSendDuration.record(performance.now() - start, attrs);

    if (result.success) {
      egressMessagesSent.add(1, attrs);
      await this.shadowPublish(
        tenantId,
        account.channel,
        account.provider,
        accountId,
        message,
        result,
      );
    } else {
      egressSendFailures.add(1, attrs);
    }

    return result;
  }

  private async shadowPublish(
    tenantId: string,
    channel: Channel,
    channelProvider: ChannelProvider,
    accountId: string,
    message: OutboundMessage,
    result: SendMessageResult,
  ): Promise<void> {
    try {
      await this.ensureStream(tenantId);

      const subject = buildChannelSubject(
        tenantId,
        channel,
        channelProvider,
        "sent",
      );

      const envelope = {
        id: crypto.randomUUID(),
        specversion: "1.0",
        type: `io.yoizen.messaging.${channel}.${channelProvider}.sent.v1`,
        source: `//channel-service/accounts/${accountId}`,
        time: new Date().toISOString(),
        datacontenttype: "application/json",
        subject,
        data: {
          to: message.to,
          type: message.type,
          providerMessageId: result.providerMessageId,
          accountId,
        },
        tenantId,
        channel,
        provider: channelProvider,
        kind: "sent",
        idempotencyKey: `${tenantId}:${channel}:sent:${result.providerMessageId ?? crypto.randomUUID()}`,
      };

      const hdrs = natsHeaders();
      hdrs.set(TENANT_HEADER, tenantId);
      hdrs.set("Nats-Msg-Id", envelope.idempotencyKey);

      await this.js.publish(
        subject,
        encoder.encode(JSON.stringify(envelope)),
        { headers: hdrs },
      );
    } catch (err) {
      this.logger.warn(
        `Shadow publish failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async ensureStream(tenantId: string): Promise<void> {
    const streamName = buildIngressStreamName(tenantId);
    if (ensuredStreams.has(streamName)) return;

    const subjects = [buildTenantWildcard(tenantId)];
    await ensureIngressStream(this.jsm, streamName, subjects);
    ensuredStreams.add(streamName);
  }
}
