import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  MsgHdrs,
} from "nats";
import {
  PinoLoggerService,
  injectTraceContext,
  logWithEnvelope,
  startNatsConsumerSpan,
  startNatsProducerSpan,
  createNatsConsumerMetrics,
  isWorkerMode,
  resolveServiceName,
} from "@yoizen/observability";
import { context as otelContext } from "@opentelemetry/api";
import { headers as natsHeaders } from "nats";
import type Redis from "ioredis";
import {
  deriveEnvelope,
  DepthExceededError,
  RESULT_TTL,
  RESULT_KEY_PREFIX,
  TENANT_HEADER,
} from "@yoizen/shared";
import type {
  EventEnvelope,
  ProcessedEvent,
  CompletionEvent,
  JsonValue,
} from "@yoizen/shared";
import {
  MultiTenantConsumerManager,
  REDIS_CLIENT,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
  ensureTenantIngressStream,
} from "../../providers/nats.provider";
import { ProcessorPipelineDeps } from "./processor-pipeline-deps";
import type { IPipelineContext } from "../../pipeline/pipeline-stage.interface";

/**
 * Canonical subject pattern (wdocs 02 §9.2) for events published by the
 * api-gateway into per-tenant `INGRESS-<tenant>` streams.
 */
const CANONICAL_GATEWAY_EVENT_PATTERN =
  "evt.*.api-gateway.platform.events.gateway.>";
const DURABLE_NAME = "event-processor";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
/**
 * Handler concurrency per replica. The pipeline performs up to two
 * external `tracedFetch` calls (enrichment + forward) per message, so
 * serial processing (concurrency=1) head-of-line-blocks the tenant
 * queue when any single downstream is slow. Bounded by
 * `max_ack_pending` on the server side.
 */
const HANDLER_CONCURRENCY = 32;

/**
 * Consumes JetStream messages, runs the enrichment pipeline, dispatches to
 * type handlers, persists results to Redis, and publishes a compliant
 * completion EventEnvelope to the RESULTS stream (wdocs 02 §9.3).
 */
@Injectable()
export class ProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(ProcessorService.name);
  private readonly encoder = new TextEncoder();
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_PUBLISHER) private readonly publisher: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly pipelineDeps: ProcessorPipelineDeps,
  ) {}

  async onModuleInit(): Promise<void> {
    const ensureOnly = !isWorkerMode();
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: CANONICAL_GATEWAY_EVENT_PATTERN,
      description: "Event processor — gateway events pipeline",
      metrics: createNatsConsumerMetrics(resolveServiceName("event-processor")),
      runnerOptions: { concurrency: HANDLER_CONCURRENCY },
      ensureOnly,
    };
    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.publisher,
      config,
      (msg: JsMsg) => this.handleJsMessage(msg),
      this.logger,
    );
    await this.manager.start();
    this.logger.log(
      ensureOnly
        ? `Pre-created '${DURABLE_NAME}' durable consumer (api mode, ensure-only)`
        : `Processor durable consumer ('${DURABLE_NAME}') started`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /**
   * JetStream-path handler: throws on failure so the runner can nak
   * and trigger redelivery with backoff.
   */
  private async handleJsMessage(msg: JsMsg): Promise<void> {
    const envelope = JSON.parse(
      new TextDecoder().decode(msg.data),
    ) as EventEnvelope;
    await this.dispatch(envelope, msg.subject, msg.headers);
  }

  private async dispatch(
    envelope: EventEnvelope,
    subject: string,
    headers: MsgHdrs | undefined,
  ): Promise<void> {
    const tenantId =
      envelope.tenant || headers?.get(TENANT_HEADER) || undefined;

    // Resume distributed trace from the publisher (wdocs 06 §6).
    const incomingHeaders = headers ?? natsHeaders();
    const { span, context: spanCtx } = startNatsConsumerSpan(
      resolveServiceName("event-processor"),
      subject,
      incomingHeaders,
    );

    try {
      await otelContext.with(spanCtx, async () => {
        const context: IPipelineContext = {
          subject,
          correlationId:
            envelope.correlation_id ||
            headers?.get("X-Correlation-Id") ||
            undefined,
          tenantId,
        };
        const enriched = await this.pipelineDeps.pipeline.run(
          envelope,
          context,
        );
        await this.processEvent(enriched, tenantId);
      });
    } finally {
      span.end();
    }
  }

  /**
   * Runs handler for `envelope.type`, stores Redis result, publishes a
   * compliant completion EventEnvelope.
   *
   * The completion body carries the legacy `CompletionEvent` shape as
   * `data.payload` so existing downstream consumers (webhook-service)
   * keep working after they're updated to unwrap `envelope.data.payload`.
   *
   * @param envelope - Parsed CloudEvents-shaped body.
   * @param tenantId - Tenant scope from envelope or message headers.
   */
  async processEvent(
    envelope: EventEnvelope,
    tenantId?: string,
  ): Promise<void> {
    const {
      id: eventId,
      type,
      data: envelopeData,
      callback_url,
      adapter_id,
    } = envelope;
    const payload = envelopeData?.payload ?? {};

    const handler =
      this.pipelineDeps.registry.get(type) ?? this.pipelineDeps.defaultHandler;
    const { processed, data } = await handler.handle(eventId, payload);

    const result: ProcessedEvent = {
      eventId,
      type,
      processed,
      timestamp: Date.now(),
      ...(data !== undefined && { data }),
      ...(tenantId && { tenant: tenantId }),
      ...(envelope.correlation_id && {
        correlation_id: envelope.correlation_id,
      }),
    };

    const keyPrefix = tenantId ? `${tenantId}:` : "";
    const key = `${keyPrefix}${RESULT_KEY_PREFIX}${eventId}`;
    const resultJson = JSON.stringify(result);

    const completion: CompletionEvent = {
      eventId,
      type,
      result,
      ...(callback_url && { callback_url }),
      ...(adapter_id && { adapter_id }),
    };

    // Build a compliant completion envelope: causation_id = entrada.id,
    // correlation_id heredado, depth+1, idempotencykey sha256(canonical).
    // Wraps the legacy CompletionEvent as its `data.payload` so the
    // webhook-service keeps seeing the same shape once it unwraps.
    // Canonical 8-token subject (wdocs 02 §9.3): lands in
    // `INGRESS-<tenant>` for the webhook-service and audit-service.
    const completionSubject = tenantId
      ? `evt.${tenantId}.event-processor.platform.events.gateway.completed.v1`
      : null;
    let completionEnvelope: EventEnvelope;
    try {
      completionEnvelope = deriveEnvelope(envelope, {
        id: `${eventId}:completion`,
        type: `${type}.completion`,
        source: "//event-processor/completion",
        resource: `tenant/${tenantId ?? envelope.tenant}/event/${eventId}/completion`,
        producer: "event-processor",
        domain: "platform",
        channel: "events",
        provider: "gateway",
        accountid: envelope.accountid,
        category: "internal_service",
        payload: completion as unknown as Record<string, JsonValue>,
        transportExtras: { method: "stream", protocol: "internal" },
      });
    } catch (err) {
      if (err instanceof DepthExceededError) {
        logWithEnvelope(
          this.logger,
          envelope,
          "event_processor.depth_exceeded",
          `MAX_DEPTH exceeded, dropping completion: ${err.message}`,
          "warn",
        );
        // Still persist the Redis result so callers polling getResult
        // see the final state.
        await this.redis.setex(key, RESULT_TTL, resultJson);
        return;
      }
      throw err;
    }

    if (!completionSubject) {
      // No tenant → nowhere canonical to publish. Persist the Redis
      // result so synchronous callers still see it and bail.
      await this.redis.setex(key, RESULT_TTL, resultJson);
      return;
    }

    const hdrs = natsHeaders();
    if (tenantId) hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", completionEnvelope.idempotencykey);
    hdrs.set("X-Correlation-Id", completionEnvelope.correlation_id);
    if (completionEnvelope.causation_id) {
      hdrs.set("X-Causation-Id", completionEnvelope.causation_id);
    }
    injectTraceContext(hdrs);

    const { span } = startNatsProducerSpan(
      resolveServiceName("event-processor"),
      completionSubject,
      hdrs,
    );

    const body = this.encoder.encode(JSON.stringify(completionEnvelope));
    try {
      await ensureTenantIngressStream(this.jsm, tenantId as string);
      await Promise.all([
        this.redis.setex(key, RESULT_TTL, resultJson),
        this.publisher.publish(completionSubject, body, { headers: hdrs }),
      ]);
    } finally {
      span.end();
    }
  }
}
