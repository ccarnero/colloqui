import { Inject, Injectable, Optional } from "@nestjs/common";
import type { NatsConnection } from "nats";
import { headers as natsHeaders } from "nats";
import {
  activeOrRandomTraceId,
  injectTraceContext,
  logWithEnvelope,
  PinoLoggerService,
  startNatsProducerSpan,
} from "@yoizen/observability";
import {
  canonicalByteLength,
  computeIdempotencyKey,
  computePayloadChecksum,
  buildRegistryPlatformSubject,
  PLATFORM_DOMAIN,
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
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { registryServiceConfig } from "../../config";

const encoder = new TextEncoder();

/**
 * Publishes registry lifecycle events to NATS (wdocs-02 canonical
 * envelope). Disabled when `REGISTRY_EMIT_ADAPTER_SYNC=false` so rollout
 * can happen without redeploying registry-service.
 *
 * Publishes to Core NATS (not JetStream directly). INGRESS streams with
 * matching subjects will persist the message; Core subscribers (like
 * adapter-service internal-sync) receive it in real time.
 */
@Injectable()
export class ServiceEventsPublisher {
  private readonly logger = new PinoLoggerService(ServiceEventsPublisher.name);

  constructor(
    @Optional()
    @Inject(NATS_CONNECTION)
    private readonly nc: NatsConnection | null,
  ) {}

  /** Feature-flagged: no-op when publishing is disabled. */
  get enabled(): boolean {
    return registryServiceConfig.emitAdapterSync && this.nc !== null;
  }

  async publishUpserted(payload: IServiceConfigUpsertedPayload): Promise<void> {
    if (!this.enabled) return;
    await this.publish(
      payload.tenantId,
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
      PLATFORM_KIND_SERVICE_DELETED,
      SERVICE_DELETED_EVENT_TYPE,
      payload as unknown as Record<string, unknown>,
      `tenant/${payload.tenantId}/service/${payload.serviceId}`,
    );
  }

  private async publish(
    tenantId: string,
    kind: string,
    type: string,
    payload: Record<string, unknown>,
    resource: string,
  ): Promise<void> {
    const conn = this.nc;
    if (!conn) return;

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
      domain: PLATFORM_DOMAIN,
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

    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", idempotencykey);
    hdrs.set("X-Correlation-Id", correlationId);
    injectTraceContext(hdrs);

    const { span } = startNatsProducerSpan(
      "registry-service",
      subject,
      hdrs,
    );

    try {
      conn.publish(subject, encoder.encode(JSON.stringify(envelope)), {
        headers: hdrs,
      });
      await conn.flush();
      logWithEnvelope(
        this.logger,
        envelope,
        `registry.${kind}.published`,
        `Published ${kind} event to ${subject}`,
      );
    } catch (err) {
      logWithEnvelope(
        this.logger,
        envelope,
        `registry.${kind}.publish_failed`,
        `Failed to publish ${kind}: ${err instanceof Error ? err.message : err}`,
        "error",
      );
    } finally {
      span.end();
    }
  }
}
