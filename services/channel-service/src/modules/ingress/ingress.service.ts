import { Inject, Injectable } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, ObjectStore } from "nats";
import { headers as natsHeaders, StorageType } from "nats";
import type { Channel, ChannelProvider, EventEnvelope, InboundMessage } from "@yoizen/shared";
import {
  TENANT_HEADER,
  CLAIM_CHECK_THRESHOLD_BYTES,
  CLAIM_CHECK_BUCKET_TTL_NS,
  CLAIM_CHECK_BUCKET_MAX_BYTES,
  buildChannelSubject,
  buildClaimCheckBucket,
  buildDlqMessageSubject,
  buildDlqStreamName,
  canonicalJson,
  canonicalByteLength,
  computePayloadChecksum,
} from "@yoizen/shared";
import {
  injectTraceContext,
  PinoLoggerService,
  startNatsProducerSpan,
} from "@yoizen/observability";
import { ensureTenantIngressStream, ensureTenantDlqStream } from "@yoizen/database";
import {
  JETSTREAM_PUBLISHER,
  JETSTREAM_MANAGER,
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
  correlationId?: string;
  causationId?: string | null;
  depth?: number;
}

/** Options for publishing a single inbound message to JetStream. */
interface IPublishMessageOptions {
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  accountId: string;
  message: InboundMessage;
  correlationId?: string;
  causationId?: string | null;
  depth?: number;
}

/**
 * Claim-check publish: publishes a compliant slim envelope when the
 * full envelope serialization exceeds CLAIM_CHECK_THRESHOLD_BYTES.
 * Carries the full envelope so the slim envelope and DLQ body can be built.
 */
interface IPublishWithClaimCheckParams {
  readonly tenantId: string;
  readonly subject: string;
  readonly envelope: EventEnvelope;
}

@Injectable()
export class IngressService {
  private readonly logger = new PinoLoggerService(IngressService.name);
  /** tenantId → ObjectStore bucket. Bound lazily on first use. */
  private readonly claimCheckBuckets = new Map<string, ObjectStore>();

  constructor(
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
  ) {}

  /**
   * Resolves (and lazily creates) the tenant-scoped Object Store bucket for
   * claim-check payloads. Bucket layout: `PAYLOAD-<tenant>`.
   *
   * Bucket options align with doc §4.2:
   *   - `ttl`: 7 days in nanoseconds (aligned to stream max_age).
   *   - `max_bytes`: 512 MB.
   *   - `storage`: File (durable across server restarts).
   *
   * Note: `views.os` does not reconfigure an existing bucket — dev buckets
   * created earlier keep their defaults until recreated (`nats object rm`).
   */
  private async getClaimCheckBucket(tenantId: string): Promise<ObjectStore> {
    const cached = this.claimCheckBuckets.get(tenantId);
    if (cached) return cached;
    const bucketName = buildClaimCheckBucket(tenantId);
    const os = await this.js.views.os(bucketName, {
      description: `Claim-check payloads for tenant ${tenantId}`,
      // CLAIM_CHECK_BUCKET_TTL_NS is already nanoseconds — do NOT wrap in nanos()
      ttl: CLAIM_CHECK_BUCKET_TTL_NS,
      max_bytes: CLAIM_CHECK_BUCKET_MAX_BYTES,
      storage: StorageType.File,
    });
    this.claimCheckBuckets.set(tenantId, os);
    return os;
  }

  /**
   * Processes inbound messages: builds envelopes and publishes to JetStream.
   * Returns immediately — publishing happens asynchronously per message.
   */
  async processInbound(options: IProcessInboundOptions): Promise<void> {
    const { tenantId, channel, provider, accountId, messages, correlationId, causationId, depth } = options;
    await ensureTenantIngressStream(this.jsm, tenantId);

    const publishPromises = messages.map((msg) =>
      this.publishMessage({
        tenantId,
        channel,
        provider,
        accountId,
        message: msg,
        correlationId,
        causationId,
        depth,
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
    const { tenantId, channel, provider, accountId, message, correlationId, causationId, depth } = options;
    const envelope = createChannelEnvelope({
      tenantId,
      channel,
      provider,
      kind: "received",
      message,
      accountId,
      correlationId,
      causationId,
      depth,
    });
    const subject = buildChannelSubject(tenantId, channel, provider, "received");

    // Trigger on full-serialized-envelope byte length: guards the actual
    // 1 MB NATS max_payload. The slim claim-check envelope is ~2 KB so it
    // always fits. 256 KB is the configured threshold (CLAIM_CHECK_THRESHOLD_BYTES).
    const payloadBytes = UTF8_TEXT_ENCODER.encode(JSON.stringify(envelope));
    const start = performance.now();

    if (payloadBytes.byteLength > CLAIM_CHECK_THRESHOLD_BYTES) {
      ingressClaimCheckCount.add(1, { channel, tenant: tenantId });
      try {
        await this.publishWithClaimCheck({ tenantId, subject, envelope });
      } finally {
        ingressPublishDuration.record(performance.now() - start, {
          channel,
          tenant: tenantId,
        });
      }
      return;
    }

    await this.publishInline(subject, envelope, payloadBytes, start, channel, tenantId);
  }

  /** Publish the full envelope bytes inline (common path). */
  private async publishInline(
    subject: string,
    envelope: EventEnvelope,
    payloadBytes: Uint8Array,
    start: number,
    channel: string,
    tenantId: string,
  ): Promise<void> {
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
      await this.js.publish(subject, payloadBytes, { headers: hdrs });
    } finally {
      span.end();
      ingressPublishDuration.record(performance.now() - start, {
        channel,
        tenant: tenantId,
      });
    }
  }

  /**
   * Claim-check publish (DOCS/messaging/claim-check.md §3):
   * 1. Store exactly `canonicalJson(envelope.data.payload)` bytes in the
   *    tenant's Object Store bucket. This is the invariant that lets
   *    the consumer verify: sha256(storedRawBytes) === payload_checksum.
   * 2. Publish a compliant slim EventEnvelope with payload_inline:false.
   * 3. On store failure: best-effort DLQ publish (original envelope as body)
   *    then rethrow the original error.
   *
   * Headers are identical to the inline path: TENANT_HEADER, Nats-Msg-Id,
   * trace context, and producer span. No X-Claim-Check header (detection
   * is via body — envelope.data.payload_inline === false).
   */
  private async publishWithClaimCheck(
    params: IPublishWithClaimCheckParams,
  ): Promise<void> {
    const { tenantId, subject, envelope } = params;
    const objectKey = `${envelope.id}-payload`;
    const bucketName = buildClaimCheckBucket(tenantId);
    const payloadRef = `nats://objstore/${bucketName}/${objectKey}`;

    // Store exactly the UTF-8 bytes of canonicalJson(payload).
    // Consumer verifies sha256 over these RAW bytes (never re-canonicalizes).
    const payloadCanonical = UTF8_TEXT_ENCODER.encode(
      canonicalJson(envelope.data?.payload),
    );

    try {
      const bucket = await this.getClaimCheckBucket(tenantId);
      await bucket.putBlob(
        {
          name: objectKey,
          description: `Envelope ${envelope.id} claim-check payload (${payloadCanonical.byteLength} bytes)`,
        },
        payloadCanonical,
      );
      ingressClaimCheckStored.add(1, { tenant: tenantId });
    } catch (storeErr) {
      ingressClaimCheckStoreFailed.add(1, { tenant: tenantId });
      this.logger.error(
        `Claim-check store failed for ${objectKey}: ${storeErr instanceof Error ? storeErr.message : storeErr}`,
      );

      // Best-effort DLQ publish on store failure (doc §3.3).
      // The DLQ body is the FULL original envelope (inline payload) so it
      // can be replayed. This publish is wrapped in its own try/catch so a
      // DLQ failure does NOT mask the store error.
      try {
        await ensureTenantDlqStream(this.jsm, tenantId);
        const dlqSubject = buildDlqMessageSubject(tenantId, subject);
        const dlqHdrs = natsHeaders();
        dlqHdrs.set("X-Dlq-Reason", "claim_check_store_failed");
        dlqHdrs.set("X-Dlq-Stage", "ingress_claim_check");
        dlqHdrs.set("X-Dlq-Original-Subject", subject);
        dlqHdrs.set("X-Dlq-Stream", buildDlqStreamName(tenantId));
        dlqHdrs.set("X-Dlq-Original-Msg-Id", envelope.idempotencykey);
        await this.js.publish(
          dlqSubject,
          UTF8_TEXT_ENCODER.encode(JSON.stringify(envelope)),
          {
            headers: dlqHdrs,
            msgID: `dlq:${envelope.idempotencykey}`,
          },
        );
      } catch (dlqErr) {
        this.logger.error(
          `DLQ publish failed for ${objectKey} (original store error is still thrown): ${dlqErr instanceof Error ? dlqErr.message : dlqErr}`,
        );
      }

      // Always rethrow the original store error regardless of DLQ outcome.
      throw storeErr;
    }

    // Build a compliant slim EventEnvelope (payload_inline:false).
    // payload_bytes reflects the canonical payload size (not the envelope size).
    const slimEnvelope: EventEnvelope = {
      ...envelope,
      data: {
        ...envelope.data,
        payload_inline: false,
        payload_ref: payloadRef,
        payload_bytes: canonicalByteLength(envelope.data?.payload),
        payload_checksum: computePayloadChecksum(envelope.data?.payload),
        payload: null,
      },
    };

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
      this.logger.log(
        `Claim-check: ${payloadCanonical.byteLength} bytes stored at ${payloadRef}`,
      );
      await this.js.publish(
        subject,
        UTF8_TEXT_ENCODER.encode(JSON.stringify(slimEnvelope)),
        { headers: hdrs },
      );
    } finally {
      span.end();
    }
  }
}
