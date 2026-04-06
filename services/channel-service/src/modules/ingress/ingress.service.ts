import { Inject, Injectable } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager } from "nats";
import { headers as natsHeaders } from "nats";
import type { Channel, ChannelProvider, InboundMessage } from "@yoizen/shared";
import { TENANT_HEADER, CLAIM_CHECK_THRESHOLD_BYTES } from "@yoizen/shared";
import {
  injectTraceContext,
  PinoLoggerService,
  startNatsProducerSpan,
} from "@yoizen/observability";
import {
  JETSTREAM_PUBLISHER,
  JETSTREAM_MANAGER,
  ensureTenantIngressStream,
} from "../../providers/nats.provider";
import { createChannelEnvelope } from "../../domain/envelope.factory";
import {
  ingressMessagesPublished,
  ingressPublishFailures,
  ingressClaimCheckCount,
  ingressPublishDuration,
} from "./ingress.metrics";
import { UTF8_TEXT_ENCODER } from "../../common/utf8-text-encoder";

interface IProcessInboundOptions {
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  accountId: string;
  messages: InboundMessage[];
}

/** Options for publishing a single inbound message to JetStream. */
interface IPublishMessageOptions {
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  accountId: string;
  message: InboundMessage;
}

/** Claim-check publish: small reference message when payload exceeds threshold. */
interface IPublishWithClaimCheckParams {
  readonly tenantId: string;
  readonly subject: string;
  readonly idempotencyKey: string;
  readonly payloadBytes: Uint8Array;
}

@Injectable()
export class IngressService {
  private readonly logger = new PinoLoggerService(IngressService.name);

  constructor(
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
  ) {}

  /**
   * Processes inbound messages: builds envelopes and publishes to JetStream.
   * Returns immediately — publishing happens asynchronously per message.
   */
  async processInbound(options: IProcessInboundOptions): Promise<void> {
    const { tenantId, channel, provider, accountId, messages } = options;
    await ensureTenantIngressStream(this.jsm, tenantId);

    const publishPromises = messages.map((msg) =>
      this.publishMessage({
        tenantId,
        channel,
        provider,
        accountId,
        message: msg,
      }),
    );

    const results = await Promise.allSettled(publishPromises);

    let published = 0;
    const attrs = { channel, tenant: tenantId };
    for (const result of results) {
      if (result.status === "fulfilled") {
        published++;
        ingressMessagesPublished.add(1, attrs);
      } else {
        ingressPublishFailures.add(1, attrs);
        this.logger.warn(`Publish failed: ${result.reason}`);
      }
    }

    this.logger.log(
      `Ingress: ${published}/${messages.length} messages published for tenant=${tenantId} channel=${channel}`,
    );
  }

  private async publishMessage(
    options: IPublishMessageOptions,
  ): Promise<void> {
    const { tenantId, channel, provider, accountId, message } = options;
    const envelope = createChannelEnvelope({
      tenantId,
      channel,
      provider,
      kind: "received",
      message,
      accountId,
    });

    const payload = JSON.stringify(envelope);
    const payloadBytes = UTF8_TEXT_ENCODER.encode(payload);
    const start = performance.now();

    if (payloadBytes.byteLength > CLAIM_CHECK_THRESHOLD_BYTES) {
      ingressClaimCheckCount.add(1, { channel, tenant: tenantId });
      await this.publishWithClaimCheck({
        tenantId,
        subject: envelope.subject,
        idempotencyKey: envelope.idempotencyKey,
        payloadBytes,
      });
      return;
    }

    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", envelope.idempotencyKey);
    injectTraceContext(hdrs);

    const { span } = startNatsProducerSpan(
      "channel-service",
      envelope.subject,
      hdrs,
    );

    try {
      await this.js.publish(envelope.subject, payloadBytes, {
        headers: hdrs,
      });
    } finally {
      span.end();
    }

    ingressPublishDuration.record(performance.now() - start, {
      channel,
      tenant: tenantId,
    });
  }

  private async publishWithClaimCheck(
    params: IPublishWithClaimCheckParams,
  ): Promise<void> {
    const { tenantId, subject, idempotencyKey, payloadBytes } = params;
    const claimId = crypto.randomUUID();

    const claimRef = JSON.stringify({
      claimCheck: true,
      claimId,
      tenantId,
      size: payloadBytes.byteLength,
    });

    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", idempotencyKey);
    hdrs.set("X-Claim-Check", claimId);

    this.logger.log(
      `Claim-check: payload ${payloadBytes.byteLength} bytes stored as ${claimId}`,
    );

    await this.js.publish(subject, UTF8_TEXT_ENCODER.encode(claimRef), { headers: hdrs });
  }

}
