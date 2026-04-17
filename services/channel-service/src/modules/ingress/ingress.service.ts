import { Inject, Injectable } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, ObjectStore } from "nats";
import { headers as natsHeaders } from "nats";
import type { Channel, ChannelProvider, InboundMessage } from "@yoizen/shared";
import {
  TENANT_HEADER,
  CLAIM_CHECK_THRESHOLD_BYTES,
  buildChannelSubject,
  buildClaimCheckBucket,
  computePayloadChecksum,
} from "@yoizen/shared";
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
  ingressClaimCheckStored,
  ingressClaimCheckStoreFailed,
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
  readonly envelopeId: string;
  readonly idempotencyKey: string;
  readonly payloadBytes: Uint8Array;
  readonly payloadChecksum: string;
}

@Injectable()
export class IngressService {
  private readonly logger = new PinoLoggerService(IngressService.name);
  /** tenantId -> ObjectStore bucket. Bound lazily on first use. */
  private readonly claimCheckBuckets = new Map<string, ObjectStore>();

  constructor(
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
  ) {}

  /**
   * Resolves (and lazily creates) the tenant-scoped Object Store bucket for
   * claim-check payloads. Bucket layout: `PAYLOAD-<tenant>`.
   */
  private async getClaimCheckBucket(tenantId: string): Promise<ObjectStore> {
    const cached = this.claimCheckBuckets.get(tenantId);
    if (cached) return cached;
    const bucketName = buildClaimCheckBucket(tenantId);
    const os = await this.js.views.os(bucketName, {
      description: `Claim-check payloads for tenant ${tenantId}`,
    });
    this.claimCheckBuckets.set(tenantId, os);
    return os;
  }

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
    const subject = buildChannelSubject(tenantId, channel, provider, "received");

    const payload = JSON.stringify(envelope);
    const payloadBytes = UTF8_TEXT_ENCODER.encode(payload);
    const start = performance.now();

    if (payloadBytes.byteLength > CLAIM_CHECK_THRESHOLD_BYTES) {
      ingressClaimCheckCount.add(1, { channel, tenant: tenantId });
      const payloadChecksum = computePayloadChecksum(envelope.data?.payload);
      await this.publishWithClaimCheck({
        tenantId,
        subject,
        envelopeId: envelope.id,
        idempotencyKey: envelope.idempotencykey,
        payloadBytes,
        payloadChecksum,
      });
      return;
    }

    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", envelope.idempotencykey);
    injectTraceContext(hdrs);

    const { span } = startNatsProducerSpan(
      "channel-service",
      subject,
      hdrs,
    );

    try {
      await this.js.publish(subject, payloadBytes, {
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

  /**
   * Claim-check publish (wdocs 02 §5.3):
   * 1. Store the raw envelope bytes in the tenant's Object Store bucket.
   * 2. Publish a slim reference envelope (`payload_inline:false`, `payload_ref`).
   * 3. Record success/failure metrics.
   *
   * Consumers should call `IngressService.resolveClaimCheckPayload(ref)` to
   * fetch the original bytes.
   */
  private async publishWithClaimCheck(
    params: IPublishWithClaimCheckParams,
  ): Promise<void> {
    const {
      tenantId,
      subject,
      envelopeId,
      idempotencyKey,
      payloadBytes,
      payloadChecksum,
    } = params;
    const objectKey = `${envelopeId}-payload`;
    const bucketName = buildClaimCheckBucket(tenantId);
    const payloadRef = `nats://objstore/${bucketName}/${objectKey}`;

    try {
      const bucket = await this.getClaimCheckBucket(tenantId);
      await bucket.putBlob(
        {
          name: objectKey,
          description: `Envelope ${envelopeId} claim-check payload (${payloadBytes.byteLength} bytes)`,
        },
        payloadBytes,
      );
      ingressClaimCheckStored.add(1, { tenant: tenantId });
    } catch (err) {
      ingressClaimCheckStoreFailed.add(1, { tenant: tenantId });
      this.logger.error(
        `Claim-check store failed for ${objectKey}: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }

    const claimRef = JSON.stringify({
      claimCheck: true,
      tenantId,
      envelopeId,
      payload_ref: payloadRef,
      payload_bytes: payloadBytes.byteLength,
      payload_checksum: payloadChecksum,
    });

    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", idempotencyKey);
    hdrs.set("X-Claim-Check", payloadRef);
    injectTraceContext(hdrs);

    const { span } = startNatsProducerSpan(
      "channel-service",
      subject,
      hdrs,
    );

    try {
      this.logger.log(
        `Claim-check: payload ${payloadBytes.byteLength} bytes stored at ${payloadRef}`,
      );
      await this.js.publish(subject, UTF8_TEXT_ENCODER.encode(claimRef), {
        headers: hdrs,
      });
    } finally {
      span.end();
    }
  }

  /**
   * Consumer-side helper: fetches the raw payload bytes referenced by a
   * claim-check envelope. Accepts either a `nats://objstore/<bucket>/<key>`
   * URI or a raw `{ bucket, key }` pair.
   */
  async resolveClaimCheckPayload(payloadRef: string): Promise<Uint8Array> {
    const m = /^nats:\/\/objstore\/([^/]+)\/(.+)$/.exec(payloadRef);
    if (!m) {
      throw new Error(`Invalid claim-check ref: ${payloadRef}`);
    }
    const [, bucketName, objectKey] = m;
    const tenantId = bucketName.startsWith("PAYLOAD-")
      ? bucketName.slice("PAYLOAD-".length)
      : bucketName;
    const bucket = await this.getClaimCheckBucket(tenantId);
    const bytes = await bucket.getBlob(objectKey);
    if (!bytes) {
      throw new Error(`Claim-check payload not found: ${payloadRef}`);
    }
    return bytes;
  }
}
