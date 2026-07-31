import { randomUUID } from "node:crypto";
import {
  type FactoryProvider,
  Inject,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  activeOrRandomTraceId,
  injectTraceContext,
  logWithEnvelope,
  PinoLoggerService,
  startNatsProducerSpan,
} from "@yoizen/observability";
import {
  ensureTenantIngressStream,
  JetStreamCapacityError,
} from "@yoizen/database";
import type { EventData, EventEnvelope, EventTransport } from "@yoizen/shared";
import {
  AGENT_MEMORY_DOMAIN,
  AGENT_MEMORY_EXPIRED,
  AGENT_MEMORY_PRODUCER,
  AGENT_MEMORY_PROPOSED,
  AGENT_MEMORY_PUBLISHED,
  AGENT_MEMORY_REJECTED,
  buildPlatformSubject,
  getTenantStreamName,
  DepthExceededError,
  MAX_DEPTH_BY_CATEGORY,
  PLATFORM_ACCOUNT_ID,
  PLATFORM_CHANNEL,
  PLATFORM_PROVIDER,
} from "@yoizen/shared";
import {
  connect,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  headers as natsHeaders,
  type PubAck,
} from "nats";
import { agentMemoryServiceConfig } from "../config";
import type { IMemory } from "../modules/memory/domain/memory.entity";
import type { INatsPublisher } from "../modules/memory/services/memory.service";
import {
  calculateChecksum,
  serializeCanonicalPayload,
} from "../utils/payload-utils";
import { buildEventTypeFromSubject } from "./agent-memory-event-type";

const DEFAULT_TRANSPORT: EventTransport = {
  method: "agent",
  protocol: "internal",
  agent_id: "agent-memory-service",
  depth: 0,
};

/**
 * Envelope `type` per lifecycle event, projected from the subject each one is
 * published on (`buildEventTypeFromSubject`), so type and subject can never
 * disagree. Yields the prescriptive
 * `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1` of envelope.md:77 —
 * e.g. `io.yoizen.agent-memory.platform.internal.memory_proposed.v1`.
 * Previously a hardcoded, channel-less, dotted-kind literal; see that helper's
 * HISTORY note.
 */
const EVENT_TYPES = {
  MEMORY_PROPOSED: buildEventTypeFromSubject(AGENT_MEMORY_PROPOSED),
  MEMORY_PUBLISHED: buildEventTypeFromSubject(AGENT_MEMORY_PUBLISHED),
  MEMORY_REJECTED: buildEventTypeFromSubject(AGENT_MEMORY_REJECTED),
  MEMORY_EXPIRED: buildEventTypeFromSubject(AGENT_MEMORY_EXPIRED),
} as const;

interface IBuildEventOptions {
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  resource: string;
  correlationId: string;
  source: string;
  causationId?: string | null;
  depth?: number;
}

const NATS_CONNECT_TIMEOUT_MS = 10_000;
const NATS_MAX_RECONNECT_ATTEMPTS = 5;

class LazyNatsConnection {
  private connection?: NatsConnection;
  private connectionPromise?: Promise<NatsConnection>;
  private jsm?: JetStreamManager;
  private jsc?: JetStreamClient;
  private readonly logger = new PinoLoggerService("LazyNatsConnection");

  constructor(
    private readonly servers: string,
    private readonly timeoutMs = NATS_CONNECT_TIMEOUT_MS,
    private readonly maxReconnectAttempts = NATS_MAX_RECONNECT_ATTEMPTS
  ) {}

  async getConnection(): Promise<NatsConnection> {
    if (this.connection) {
      return this.connection;
    }

    if (!this.connectionPromise) {
      this.logger.log(`Connecting to NATS at ${this.servers}...`);
      this.connectionPromise = connect({
        servers: this.servers,
        name: "agent-memory-service",
        timeout: this.timeoutMs,
        maxReconnectAttempts: this.maxReconnectAttempts,
      })
        .then((nc) => {
          this.connection = nc;
          this.logger.log("NATS connection established");
          return nc;
        })
        .catch((error: unknown) => {
          this.connectionPromise = undefined;
          throw error;
        });
    }

    return this.connectionPromise;
  }

  async jetstreamManager(): Promise<JetStreamManager> {
    if (this.jsm) {
      return this.jsm;
    }
    const nc = await this.getConnection();
    this.jsm = await nc.jetstreamManager();
    return this.jsm;
  }

  async jetstream(): Promise<JetStreamClient> {
    if (this.jsc) {
      return this.jsc;
    }
    const nc = await this.getConnection();
    await this.jetstreamManager();
    this.jsc = nc.jetstream();
    return this.jsc;
  }

  async close(): Promise<void> {
    const nc = this.connection;
    this.connection = undefined;
    this.connectionPromise = undefined;
    this.jsm = undefined;
    this.jsc = undefined;
    if (nc) {
      await nc.close();
    }
  }
}

export const LAZY_NATS = "LAZY_NATS";

export const lazyNatsProvider: FactoryProvider<LazyNatsConnection> = {
  provide: LAZY_NATS,
  useFactory: (): LazyNatsConnection => {
    return new LazyNatsConnection(agentMemoryServiceConfig.natsUrl);
  },
};

function buildEventData(
  payload: Record<string, unknown>,
  occurredAt: string
): EventData {
  const serializedPayload = serializeCanonicalPayload(payload);

  return {
    received_at: occurredAt,
    payload_inline: true,
    payload_ref: null,
    payload_bytes: Buffer.byteLength(serializedPayload, "utf-8"),
    payload_checksum: calculateChecksum(payload),
    payload,
  };
}

function buildEventEnvelope(
  tenantId: string,
  options: IBuildEventOptions
): EventEnvelope {
  const depth = options.depth ?? 0;
  const maxDepth = MAX_DEPTH_BY_CATEGORY.internal_service;
  if (depth > maxDepth) {
    throw new DepthExceededError(
      `Causal depth ${depth} exceeds MAX_DEPTH=${maxDepth} for category=internal_service ` +
        `(event_type=${options.eventType}, tenant=${tenantId})`,
      {
        incomingId: options.causationId ?? "",
        newDepth: depth,
        maxDepth,
        category: "internal_service",
      }
    );
  }

  const eventId = randomUUID();
  const data = buildEventData(options.payload, options.occurredAt);

  return {
    specversion: "1.0",
    id: eventId,
    source: options.source,
    type: options.eventType,
    resource: options.resource,
    time: options.occurredAt,
    traceid: activeOrRandomTraceId(),
    causation_id: options.causationId ?? null,
    correlation_id: options.correlationId,
    tenant: tenantId,
    // Same rule as `domain` below: the body must not contradict its subject.
    // The subject's producer token is `agent-memory-service`, and this service
    // is what publishes the event. It previously reported agent-admin's
    // the constant then named PLATFORM_PRODUCER (today AGENT_ADMIN_PRODUCER)
    // — inherited when this file was renamed out of the admin
    // service (`R061` in `e9e3a94b`), where that value was correct.
    producer: AGENT_MEMORY_PRODUCER,
    // Subject and body must answer "which domain?" identically: the subject
    // token is `agent-memory` (AGENT_MEMORY_SUBJECT_PREFIX), so the envelope
    // says the same. It used to report agent-admin's PLATFORM_DOMAIN
    // ("automation") and contradict its own subject (envelope-drift T08).
    domain: AGENT_MEMORY_DOMAIN,
    channel: PLATFORM_CHANNEL,
    provider: PLATFORM_PROVIDER,
    accountid: PLATFORM_ACCOUNT_ID,
    idempotencykey: calculateChecksum(options.payload),
    transport: { ...DEFAULT_TRANSPORT, depth },
    data,
  };
}

export interface ICausalContext {
  readonly causationId?: string | null;
  readonly correlationId?: string;
  readonly incomingDepth?: number;
}

@Injectable()
export class NatsPublisher implements INatsPublisher, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(NatsPublisher.name);
  private readonly ensuredStreams = new Set<string>();

  constructor(
    @Inject(LAZY_NATS)
    private readonly lazyNats: LazyNatsConnection,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.lazyNats.close();
  }

  /**
   * Ensures `INGRESS-<TENANT>` exists before the first publish for a tenant.
   *
   * Delegates to `ensureTenantIngressStream` (`@yoizen/database`), the
   * platform's SINGLE creator of that stream. This service used to create it
   * here from `buildTenantStreamConfig(tenantId, "free")` — same stream name,
   * different limits — so a new tenant's stream config depended on which
   * service published first (envelope-drift post-loop item 6).
   *
   * `checkCapacity: true` preserves the pre-flight this method already did:
   * the helper throws `JetStreamCapacityError`, surfaced here as the 503 this
   * service has always returned.
   *
   * Tier-aware limits are a FUTURE design — see
   * `DOCS/v_next/tenant-messaging-tiers.md`.
   */
  private async ensureTenantStream(tenantId: string): Promise<void> {
    if (this.ensuredStreams.has(tenantId)) {
      return;
    }

    this.logger.log(`Ensuring stream for tenant '${tenantId}'...`);

    let jsm: JetStreamManager;
    try {
      jsm = await this.lazyNats.jetstreamManager();
    } catch (jsmErr: unknown) {
      const msg = jsmErr instanceof Error ? jsmErr.message : String(jsmErr);
      this.logger.error(`Failed to get JetStreamManager: ${msg}`);
      throw jsmErr;
    }

    const streamName = getTenantStreamName(tenantId);
    try {
      await ensureTenantIngressStream(jsm, tenantId, { checkCapacity: true });
      this.logger.log(`Stream '${streamName}' ensured for tenant '${tenantId}'`);
    } catch (err: unknown) {
      if (err instanceof JetStreamCapacityError) {
        this.logger.error(err.message);
        throw new ServiceUnavailableException(err.message);
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to ensure stream '${streamName}': ${msg}`);
      throw err;
    }

    this.ensuredStreams.add(tenantId);
  }


  private async publishEvent(
    tenantId: string,
    subjectTemplate: string,
    event: EventEnvelope
  ): Promise<PubAck | null> {
    const subject = buildPlatformSubject(subjectTemplate, tenantId);

    try {
      await this.ensureTenantStream(tenantId);
      const js = await this.lazyNats.jetstream();

      const hdrs = natsHeaders();
      hdrs.set("Nats-Msg-Id", event.idempotencykey);
      hdrs.set("X-Correlation-Id", event.correlation_id);
      if (event.causation_id) {
        hdrs.set("X-Causation-Id", event.causation_id);
      }
      injectTraceContext(hdrs);

      const { span } = startNatsProducerSpan(
        "agent-memory-service",
        subject,
        hdrs
      );

      try {
        const ack = await js.publish(subject, JSON.stringify(event), {
          msgID: event.idempotencykey,
          headers: hdrs,
        });
        logWithEnvelope(
          this.logger,
          event,
          "agent-memory.publish.ok",
          `Published event to ${subject}`,
          "debug"
        );
        return ack;
      } finally {
        span.end();
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logWithEnvelope(
        this.logger,
        event,
        "agent-memory.publish.error",
        `Failed to publish event to ${subject}: ${msg}`,
        "error"
      );
      throw error;
    }
  }

  async publishMemoryProposed(
    tenantId: string,
    memory: IMemory
  ): Promise<string> {
    const proposedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `memory:${memory.id}`,
      causationId: null,
      depth: 0,
      eventType: EVENT_TYPES.MEMORY_PROPOSED,
      occurredAt: proposedAt,
      payload: {
        memoryId: memory.id,
        content: memory.content,
        metadata: memory.metadata,
        proposedAt,
        status: memory.status,
      },
      resource: `tenant/${tenantId}/memories/${memory.id}`,
      source: "//agent-memory-service/memory/propose",
    });

    await this.publishEvent(tenantId, AGENT_MEMORY_PROPOSED, event);
    // Returned so the service layer can persist it as the causation
    // anchor for memory_published/memory_rejected (envelope.md §6).
    return event.id;
  }

  async publishMemoryApproved(
    tenantId: string,
    memory: IMemory,
    causal?: ICausalContext
  ): Promise<void> {
    const publishedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: causal?.correlationId ?? `memory:${memory.id}`,
      causationId: causal?.causationId ?? null,
      // Legacy memories without a proposed-event anchor stay roots.
      depth: causal?.causationId ? (causal.incomingDepth ?? 0) + 1 : 0,
      eventType: EVENT_TYPES.MEMORY_PUBLISHED,
      occurredAt: publishedAt,
      payload: {
        memoryId: memory.id,
        content: memory.content,
        publishedAt,
        status: memory.status,
      },
      resource: `tenant/${tenantId}/memories/${memory.id}`,
      source: "//agent-memory-service/memory/publish",
    });

    await this.publishEvent(tenantId, AGENT_MEMORY_PUBLISHED, event);
  }

  async publishMemoryRejected(
    tenantId: string,
    memory: IMemory,
    causal?: ICausalContext
  ): Promise<void> {
    const rejectedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: causal?.correlationId ?? `memory:${memory.id}`,
      causationId: causal?.causationId ?? null,
      depth: causal?.causationId ? (causal.incomingDepth ?? 0) + 1 : 0,
      eventType: EVENT_TYPES.MEMORY_REJECTED,
      occurredAt: rejectedAt,
      payload: {
        memoryId: memory.id,
        reason: memory.content,
        rejectedAt,
        status: memory.status,
      },
      resource: `tenant/${tenantId}/memories/${memory.id}`,
      source: "//agent-memory-service/memory/reject",
    });

    await this.publishEvent(tenantId, AGENT_MEMORY_REJECTED, event);
  }

  async publishMemoryExpired(
    tenantId: string,
    memoryId: string,
    causal?: ICausalContext
  ): Promise<PubAck | null> {
    const expiredAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: causal?.correlationId ?? `memory:${memoryId}`,
      causationId: causal?.causationId ?? null,
      depth: causal ? (causal.incomingDepth ?? 0) + 1 : 0,
      eventType: EVENT_TYPES.MEMORY_EXPIRED,
      occurredAt: expiredAt,
      payload: {
        memoryId,
        expiredAt,
        status: "expired",
      },
      resource: `tenant/${tenantId}/memories/${memoryId}`,
      source: "//agent-memory-service/memory/expire",
    });

    return this.publishEvent(tenantId, AGENT_MEMORY_EXPIRED, event);
  }
}
