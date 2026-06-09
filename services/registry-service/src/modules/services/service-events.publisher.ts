import { Inject, Injectable } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, MsgHdrs } from "nats";
import { headers as natsHeaders } from "nats";
import {
  activeOrRandomTraceId,
  injectTraceContext,
  logWithEnvelope,
  PinoLoggerService,
  startNatsProducerSpan,
} from "@yoizen/observability";
import { ensureTenantIngressStream } from "@yoizen/database";
import {
  buildRegistryPlatformSubject,
  canonicalByteLength,
  computeIdempotencyKey,
  computePayloadChecksum,
  REGISTRY_DOMAIN,
  PLATFORM_KIND_SERVICE_DELETED,
  PLATFORM_KIND_SERVICE_UPSERTED,
  PLATFORM_NON_CHANNEL_TOKEN,
  PLATFORM_RESOURCE_SERVICE,
  REGISTRY_EVENT_SOURCE,
  REGISTRY_PRODUCER,
  SERVICE_DELETED_EVENT_TYPE,
  SERVICE_UPSERTED_EVENT_TYPE,
  TENANT_HEADER,
  type EventEnvelope,
  type IServiceConfigDeletedPayload,
  type IServiceConfigUpsertedPayload,
} from "@yoizen/shared";
import { JETSTREAM, JETSTREAM_MANAGER } from "../../providers/nats.provider";
import { registryServiceConfig } from "../../config";
import {
  ServiceEventsEnsureStreamResult,
  ServiceEventsMetrics,
  ServiceEventsPublishFailureReason,
  type ServiceEventsPublishFailureReasonValue,
} from "./service-events.metrics";

/**
 * Default exponential-backoff schedule (ms) for the bounded-retry
 * envelope around `js.publish`. Capped at 2 s — anything longer would
 * push past the publisher's NFR-RSE-002 tail latency budget for slow
 * paths and leave the post-commit hook hanging in pathological broker
 * failures. Three attempts total (initial publish + 2 retries).
 *
 * @see REQ-RSE-001, REQ-RSE-003, NFR-RSE-002
 */
const RETRY_BACKOFFS_MS: readonly number[] = [100, 500, 2000];

/**
 * Lower-cased substrings used to bucket terminal publish errors into
 * the small label-cardinality `reason` set required by NFR-RSE-001.
 * Order matters — the first match wins.
 */
const ACK_TIMEOUT_MARKERS: readonly string[] = [
  "ack timeout",
  "ack-timeout",
  "timed out",
  "timeout",
  "deadline",
];
const BROKER_UNAVAILABLE_MARKERS: readonly string[] = [
  "no responders",
  "connection",
  "disconnected",
  "econnrefused",
  "econnreset",
  "unreachable",
];

/**
 * Publishes registry lifecycle events (`service.upserted.v1` /
 * `service.deleted.v1`) to JetStream on the canonical 8-token
 * platform subject. Runs as a post-commit, best-effort side-effect of
 * the originating HTTP request — see `ServicesService.register` /
 * `.update` / `.remove` for the call sites.
 *
 * Behavior contract:
 *
 *  - Feature-flagged via `REGISTRY_EMIT_ADAPTER_SYNC` (REQ-RSE-004):
 *    when off, the publisher short-circuits before touching the
 *    broker or any metric counter except the bookkeeping needed for
 *    operability.
 *  - Refuses to publish when `tenantId` is missing — the canonical
 *    subject is tenant-scoped and an unscoped publish would route
 *    into an ambiguous namespace (REQ-RSE-005).
 *  - Ensures the per-tenant `INGRESS-<TENANT>` stream exists before
 *    every publish via the shared idempotent helper from
 *    `@yoizen/database`. The publisher layers its own per-instance
 *    `Set<tenantId>` cache so hit/miss accounting is observable
 *    without reaching into helper internals (REQ-RSE-002).
 *  - Replaces the legacy Core-NATS `nc.publish` + `nc.flush()` with
 *    `js.publish(subject, body, { headers, msgID })`. `msgID` is the
 *    deterministic `idempotencykey` so JetStream-side dedup absorbs
 *    duplicate publishes within the dedup window (REQ-RSE-001).
 *  - Bounded retry (`RETRY_BACKOFFS_MS`) on broker / ack-timeout
 *    errors. Programming errors (`missing_tenant`,
 *    `ensure_stream_failed`) skip the retry envelope.
 *  - NEVER throws to the caller. The originating HTTP response is
 *    decoupled from broker liveness (REQ-RSE-003, NFR-RSE-002).
 *
 * @see specs/registry-service-events.md
 */
@Injectable()
export class ServiceEventsPublisher {
  private readonly logger = new PinoLoggerService(ServiceEventsPublisher.name);
  private readonly encoder = new TextEncoder();
  /**
   * Per-instance ensure-stream cache. Populated only on confirmed
   * success; the helper's own module-level Set provides cross-pod
   * broker-side dedup, but a publisher-local Set is what makes
   * `ensure_stream_calls{result=hit}` observable at this layer.
   *
   * O(1) `has`/`add` via the native `Set` hash semantics.
   */
  private readonly ensuredTenants = new Set<string>();

  /**
   * Test-overridable backoff schedule. Kept as an instance field
   * (rather than a module constant) so unit tests can collapse the
   * 2.6 s real-time envelope to near-zero without resorting to fake
   * timers.
   */
  retryBackoffsMs: readonly number[] = RETRY_BACKOFFS_MS;

  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    private readonly metrics: ServiceEventsMetrics,
  ) {}

  /**
   * Feature-flag gate. When `false`, every public publish method is a
   * strict no-op — no broker connection, no stream-ensure, no metric
   * mutation (REQ-RSE-004 rollback path).
   */
  get enabled(): boolean {
    return registryServiceConfig.emitAdapterSync;
  }

  async publishUpserted(payload: IServiceConfigUpsertedPayload): Promise<void> {
    if (!this.enabled) return;
    await this.publish(
      payload.tenantId,
      payload.serviceId,
      PLATFORM_KIND_SERVICE_UPSERTED,
      SERVICE_UPSERTED_EVENT_TYPE,
      payload as unknown as Record<string, unknown>,
      `tenant/${payload.tenantId}/service/${payload.serviceId}`,
    );
  }

  async publishDeleted(payload: IServiceConfigDeletedPayload): Promise<void> {
    if (!this.enabled) return;
    await this.publish(
      payload.tenantId,
      payload.serviceId,
      PLATFORM_KIND_SERVICE_DELETED,
      SERVICE_DELETED_EVENT_TYPE,
      payload as unknown as Record<string, unknown>,
      `tenant/${payload.tenantId}/service/${payload.serviceId}`,
    );
  }

  /**
   * Internal publish path. NEVER throws — every failure mode is
   * captured by metrics + structured logs and returned silently.
   */
  private async publish(
    tenantId: string,
    serviceId: string,
    kind: string,
    type: string,
    payload: Record<string, unknown>,
    resource: string,
  ): Promise<void> {
    const eventTypeAttr = { event_type: type };

    if (!tenantId) {
      this.metrics.publishFailures.add(1, {
        ...eventTypeAttr,
        reason: ServiceEventsPublishFailureReason.MISSING_TENANT,
      });
      this.logger.warn(
        `registry.${kind}.publish_dropped reason=missing_tenant serviceId=${serviceId} type=${type}`,
      );
      return;
    }

    this.metrics.publishAttempts.add(1, eventTypeAttr);

    const subject = buildRegistryPlatformSubject(
      tenantId,
      PLATFORM_RESOURCE_SERVICE,
      kind,
    );
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const traceid = activeOrRandomTraceId();
    const idempotencykey = computeIdempotencyKey(payload);
    const payloadChecksum = computePayloadChecksum(payload);
    const payloadBytes = canonicalByteLength(payload);
    const correlationId = id;

    const envelope: EventEnvelope = {
      specversion: "1.0",
      id,
      source: REGISTRY_EVENT_SOURCE,
      type,
      resource,
      time: now,
      traceid,
      causation_id: null,
      correlation_id: correlationId,
      tenant: tenantId,
      producer: REGISTRY_PRODUCER,
      domain: REGISTRY_DOMAIN,
      channel: PLATFORM_RESOURCE_SERVICE,
      provider: PLATFORM_NON_CHANNEL_TOKEN,
      accountid: tenantId,
      idempotencykey,
      transport: { method: "stream", protocol: "internal", depth: 1 },
      data: {
        received_at: now,
        payload_inline: true,
        payload_ref: null,
        payload_bytes: payloadBytes,
        payload_checksum: payloadChecksum,
        payload,
      },
    };

    const ensureOk = await this.ensureTenantStream(tenantId, envelope, kind);
    if (!ensureOk) return;

    const hdrs = this.buildHeaders(tenantId, idempotencykey, correlationId);
    /**
     * Deterministic JetStream message id. Falls back to a composite
     * key only when `computeIdempotencyKey` returns an empty string
     * (defensive — should not happen for well-formed payloads).
     */
    const msgId =
      idempotencykey.length > 0
        ? idempotencykey
        : `${tenantId}:${serviceId}:${type}:${id}`;
    const body = this.encoder.encode(JSON.stringify(envelope));

    const attempts = this.retryBackoffsMs.length;
    let lastErr: unknown = undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const { span } = startNatsProducerSpan(
        "registry-service",
        subject,
        hdrs,
      );
      try {
        await this.js.publish(subject, body, {
          headers: hdrs,
          msgID: msgId,
        });
        this.metrics.publishSuccesses.add(1, eventTypeAttr);
        logWithEnvelope(
          this.logger,
          envelope,
          `registry.${kind}.published`,
          `Published ${kind} event to ${subject} (attempt=${attempt + 1})`,
        );
        return;
      } catch (err: unknown) {
        lastErr = err;
        if (attempt === attempts - 1) break;
        await this.sleep(this.retryBackoffsMs[attempt] ?? 0);
      } finally {
        span.end();
      }
    }

    const reason = this.classifyPublishFailure(lastErr);
    this.metrics.publishFailures.add(1, { ...eventTypeAttr, reason });
    logWithEnvelope(
      this.logger,
      envelope,
      `registry.${kind}.publish_failed`,
      `Failed to publish ${kind} after ${attempts} attempts: ${stringifyError(lastErr)} (tenant=${tenantId} serviceId=${serviceId} reason=${reason})`,
      "error",
    );
  }

  /**
   * Best-effort idempotent ensure of the tenant-ingress stream with
   * O(1) per-publisher cache. Returns `false` only when the broker
   * rejects the underlying `streams.add` call — a non-retryable
   * condition (auth, quota, conflicting filter).
   */
  private async ensureTenantStream(
    tenantId: string,
    envelope: EventEnvelope,
    kind: string,
  ): Promise<boolean> {
    if (this.ensuredTenants.has(tenantId)) {
      this.metrics.ensureStreamCalls.add(1, {
        result: ServiceEventsEnsureStreamResult.HIT,
      });
      return true;
    }
    try {
      await ensureTenantIngressStream(this.jsm, tenantId);
      this.ensuredTenants.add(tenantId);
      this.metrics.ensureStreamCalls.add(1, {
        result: ServiceEventsEnsureStreamResult.MISS,
      });
      return true;
    } catch (err: unknown) {
      this.metrics.publishFailures.add(1, {
        event_type: envelope.type,
        reason: ServiceEventsPublishFailureReason.ENSURE_STREAM_FAILED,
      });
      logWithEnvelope(
        this.logger,
        envelope,
        `registry.${kind}.ensure_stream_failed`,
        `Failed to ensure tenant ingress stream for tenant=${tenantId}: ${stringifyError(err)}`,
        "error",
      );
      return false;
    }
  }

  private buildHeaders(
    tenantId: string,
    idempotencykey: string,
    correlationId: string,
  ): MsgHdrs {
    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", idempotencykey);
    hdrs.set("X-Correlation-Id", correlationId);
    injectTraceContext(hdrs);
    return hdrs;
  }

  /**
   * Classifies a terminal publish error into the small bounded
   * `reason` label set required by NFR-RSE-001. Preserves O(1)
   * per-error matching by short-circuiting on first marker hit.
   */
  private classifyPublishFailure(
    err: unknown,
  ): ServiceEventsPublishFailureReasonValue {
    const msg =
      err instanceof Error
        ? err.message.toLowerCase()
        : String(err).toLowerCase();
    for (let i = 0; i < ACK_TIMEOUT_MARKERS.length; i++) {
      if (msg.includes(ACK_TIMEOUT_MARKERS[i] ?? "")) {
        return ServiceEventsPublishFailureReason.ACK_TIMEOUT;
      }
    }
    for (let i = 0; i < BROKER_UNAVAILABLE_MARKERS.length; i++) {
      if (msg.includes(BROKER_UNAVAILABLE_MARKERS[i] ?? "")) {
        return ServiceEventsPublishFailureReason.BROKER_UNAVAILABLE;
      }
    }
    return ServiceEventsPublishFailureReason.UNKNOWN;
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
