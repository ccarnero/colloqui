import { Inject, Injectable } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, NatsConnection } from "nats";
import { headers as natsHeaders } from "nats";
import type Redis from "ioredis";
import type { Observable } from "rxjs";
import {
  RESULT_KEY_PREFIX,
  PENDING_KEY_PREFIX,
  CALLBACK_KEY_PREFIX,
  PENDING_TTL,
  CALLBACK_TTL,
  RESULT_CACHE_MAX,
  TENANT_HEADER,
  canonicalByteLength,
  computeIdempotencyKey,
  computePayloadChecksum,
} from "@yoizen/shared";
import type { EventEnvelope } from "@yoizen/shared";
import {
  activeOrRandomTraceId,
  injectTraceContext,
  startNatsProducerSpan,
} from "@yoizen/observability";
import { ensureTenantIngressStream } from "@yoizen/database";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
} from "../../providers/nats.provider";
import { REDIS_CLIENT } from "../../providers/redis.provider";
import { randomUUID } from "crypto";
import type { ISseEvent } from "../../constants";
import { createNatsMultiSubjectObservable } from "../../utils/nats-stream-observable.util";

/**
 * Canonical 8-token subject for platform events published by the
 * api-gateway (wdocs 02 §9.2).
 * Format: `evt.<tenant>.api-gateway.platform.events.gateway.<type>.v1`.
 */
function buildCanonicalGatewaySubject(tenantId: string, type: string): string {
  return `evt.${tenantId}.api-gateway.platform.events.gateway.${type}.v1`;
}

/** Single options bag for {@link EventsService.publish} (avoids long positional args). */
interface IPublishEventParams {
  type: string;
  payload: Record<string, unknown>;
  tenantId: string;
  callbackUrl?: string;
  enrichAdapter?: { adapterId: string; endpointId: string };
  forwardAdapter?: { adapterId: string; endpointId: string };
  adapterId?: string;
  /**
   * Optional business-level correlation id. Reused across the entire
   * causal chain triggered by this publish. Defaults to the new event
   * id when not provided by the caller.
   */
  correlationId?: string;
  /** Optional causation id. Defaults to `null` (root event). */
  causationId?: string;
}

@Injectable()
export class EventsService {
  private readonly resultCache = new Map<string, object>();
  private readonly encoder = new TextEncoder();

  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Publishes a CloudEvents-shaped envelope to JetStream and seeds Redis pending state.
   *
   * @param params - Event type, payload, tenant, and optional adapter routing.
   * @returns New event id (UUID).
   */
  async publish(params: IPublishEventParams): Promise<string> {
    const {
      type,
      payload,
      tenantId,
      callbackUrl,
      enrichAdapter,
      forwardAdapter,
      adapterId,
      correlationId,
      causationId,
    } = params;
    const id = randomUUID();
    const subject = buildCanonicalGatewaySubject(tenantId, type);
    const now = new Date().toISOString();

    const payloadBytes = canonicalByteLength(payload);
    const payloadChecksum = computePayloadChecksum(payload);
    const idempotencykey = computeIdempotencyKey(payload);
    const traceid = activeOrRandomTraceId();

    const envelope: EventEnvelope = {
      specversion: "1.0",
      id,
      source: "//api-gateway/events",
      type,
      resource: `tenant/${tenantId}/event/${type}`,
      time: now,
      traceid,
      causation_id: causationId ?? null,
      correlation_id: correlationId ?? id,
      tenant: tenantId,
      producer: "api-gateway",
      domain: "platform",
      channel: "events",
      provider: "gateway",
      accountid: tenantId,
      idempotencykey,
      transport: { method: "stream", protocol: "internal", depth: 0 },
      data: {
        received_at: now,
        payload_inline: true,
        payload_ref: null,
        payload_bytes: payloadBytes,
        payload_checksum: payloadChecksum,
        payload,
      },
      ...(callbackUrl && { callback_url: callbackUrl }),
      ...(adapterId && { adapter_id: adapterId }),
      ...(enrichAdapter && { enrich_adapter: enrichAdapter }),
      ...(forwardAdapter && { forward_adapter: forwardAdapter }),
    };
    const body = JSON.stringify(envelope);

    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", idempotencykey);
    if (envelope.correlation_id) {
      hdrs.set("X-Correlation-Id", envelope.correlation_id);
    }
    if (envelope.causation_id) {
      hdrs.set("X-Causation-Id", envelope.causation_id);
    }
    injectTraceContext(hdrs);

    const { span } = startNatsProducerSpan("api-gateway", subject, hdrs);

    const pipeline = this.redis.pipeline();
    pipeline.setex(
      `${tenantId}:${PENDING_KEY_PREFIX}${id}`,
      PENDING_TTL,
      JSON.stringify({ id, status: "pending" }),
    );
    if (callbackUrl) {
      pipeline.setex(
        `${tenantId}:${CALLBACK_KEY_PREFIX}${id}`,
        CALLBACK_TTL,
        callbackUrl,
      );
    }

    // Ensure the per-tenant INGRESS stream exists before publishing
    // (wdocs 02 §11). Idempotent — first call per tenant creates the
    // stream; subsequent calls short-circuit via cache.
    await ensureTenantIngressStream(this.jsm, tenantId);

    const bodyBytes = this.encoder.encode(body);

    try {
      await Promise.all([
        this.js.publish(subject, bodyBytes, { headers: hdrs }),
        pipeline.exec(),
      ]);
    } finally {
      span.end();
    }

    return id;
  }

  /**
   * Reads a processed result from L1 cache then Redis (`result:` key).
   *
   * @param id - Event id returned from {@link publish}.
   * @param tenantId - Tenant scope for key namespacing.
   */
  async getResult(id: string, tenantId: string): Promise<object | null> {
    const cacheKey = `${tenantId}:${id}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const key = `${tenantId}:${RESULT_KEY_PREFIX}${id}`;
    const raw = await this.redis.get(key);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as object;

    if (this.resultCache.size >= RESULT_CACHE_MAX) {
      const firstKey = this.resultCache.keys().next().value;
      if (firstKey !== undefined) this.resultCache.delete(firstKey);
    }
    this.resultCache.set(cacheKey, parsed);

    return parsed;
  }

  /**
   * SSE stream of canonical platform events for the tenant, filtered
   * by optional type list.
   *
   * Subscribes to per-tenant `evt.<tenant>.>` (wdocs 02 §11). When
   * `types` is non-empty, subscribes to the specific gateway kinds
   * `evt.<tenant>.api-gateway.platform.events.gateway.<type>.v1`.
   *
   * @param types - Empty array means subscribe to all canonical events
   *                for this tenant.
   * @param tenantId - Tenant scope (drops foreign tenant messages).
   */
  streamEvents(types: string[], tenantId: string): Observable<ISseEvent> {
    const subjects =
      types.length === 0
        ? [`evt.${tenantId}.>`]
        : types.map(
            (t) =>
              `evt.${tenantId}.api-gateway.platform.events.gateway.${t}.v1`,
          );

    return createNatsMultiSubjectObservable(this.nc, subjects, (msg) => {
      const data = msg.json() as EventEnvelope;
      if (data.tenant !== tenantId) return null;
      return { data, type: msg.subject };
    });
  }
}
