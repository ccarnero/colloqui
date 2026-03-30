import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager } from "nats";
import { headers as natsHeaders } from "nats";
import type {
  Channel,
  ChannelProvider,
  InboundMessage,
} from "@yoizen/shared";
import {
  TENANT_HEADER,
  CLAIM_CHECK_THRESHOLD_BYTES,
  buildIngressStreamName,
  buildTenantWildcard,
} from "@yoizen/shared";
import {
  injectTraceContext,
  startNatsProducerSpan,
} from "@yoizen/observability";
import {
  JETSTREAM_PUBLISHER,
  JETSTREAM_MANAGER,
  ensureIngressStream,
} from "../../providers/nats.provider";
import { createChannelEnvelope } from "../../domain/envelope.factory";
import {
  ingressMessagesPublished,
  ingressPublishFailures,
  ingressClaimCheckCount,
  ingressPublishDuration,
} from "./ingress.metrics";

const encoder = new TextEncoder();

const ensuredStreams = new Set<string>();

@Injectable()
export class IngressService {
  private readonly logger = new Logger(IngressService.name);

  constructor(
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
  ) {}

  /**
   * Processes inbound messages: builds envelopes and publishes to JetStream.
   * Returns immediately — publishing happens asynchronously per message.
   */
  async processInbound(
    tenantId: string,
    channel: Channel,
    provider: ChannelProvider,
    accountId: string,
    messages: InboundMessage[],
  ): Promise<void> {
    await this.ensureStream(tenantId);

    const publishPromises = messages.map((msg) =>
      this.publishMessage(tenantId, channel, provider, accountId, msg),
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
    tenantId: string,
    channel: Channel,
    provider: ChannelProvider,
    accountId: string,
    message: InboundMessage,
  ): Promise<void> {
    const envelope = createChannelEnvelope(
      tenantId,
      channel,
      provider,
      "received",
      message,
      accountId,
    );

    const payload = JSON.stringify(envelope);
    const payloadBytes = encoder.encode(payload);
    const start = performance.now();

    if (payloadBytes.byteLength > CLAIM_CHECK_THRESHOLD_BYTES) {
      ingressClaimCheckCount.add(1, { channel, tenant: tenantId });
      await this.publishWithClaimCheck(
        tenantId,
        envelope.subject,
        envelope.idempotencyKey,
        payloadBytes,
      );
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

    ingressPublishDuration.record(
      performance.now() - start,
      { channel, tenant: tenantId },
    );
  }

  private async publishWithClaimCheck(
    tenantId: string,
    subject: string,
    idempotencyKey: string,
    payloadBytes: Uint8Array,
  ): Promise<void> {
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

    await this.js.publish(
      subject,
      encoder.encode(claimRef),
      { headers: hdrs },
    );
  }

  private async ensureStream(tenantId: string): Promise<void> {
    const streamName = buildIngressStreamName(tenantId);
    if (ensuredStreams.has(streamName)) return;

    const subjects = [buildTenantWildcard(tenantId)];
    await ensureIngressStream(this.jsm, streamName, subjects);
    ensuredStreams.add(streamName);
  }
}
