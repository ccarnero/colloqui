import { randomUUID } from "node:crypto";
import {
  connect,
  RetentionPolicy,
  StorageType,
  headers as natsHeaders,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  type PubAck,
} from "nats";
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
  type FactoryProvider,
} from "@nestjs/common";
import {
  activeOrRandomTraceId,
  injectTraceContext,
  logWithEnvelope,
  PinoLoggerService,
  startNatsProducerSpan,
} from "@yoizen/observability";
import {
  DepthExceededError,
  MAX_DEPTH_BY_CATEGORY,
  PLATFORM_ACCOUNT_ID,
  PLATFORM_CHANNEL,
  PLATFORM_DOMAIN,
  PLATFORM_PRODUCER,
  PLATFORM_PROVIDER,
  buildPlatformSubject,
} from "@yoizen/shared";
import type { EventData, EventEnvelope, EventTransport } from "@yoizen/shared";
import {
  calculateChecksum,
  serializeCanonicalPayload,
} from "../utils/payload-utils";
import {
  type TenantTier,
  buildTenantStreamConfig,
  checkJetStreamCapacity,
} from "@yoizen/shared";
import { agentMemoryServiceConfig } from "../config";
import type { IMemory } from "../modules/memory/domain/memory.entity";
import type { INatsPublisher } from "../modules/memory/services/memory.service";

const DEFAULT_TRANSPORT: EventTransport = {
  method: "agent",
  protocol: "internal",
  agent_id: "agent-memory-service",
  depth: 0,
};

const EVENT_TYPES = {
  MEMORY_PROPOSED: "io.yoizen.agent-memory.memory.proposed.v1",
  MEMORY_PUBLISHED: "io.yoizen.agent-memory.memory.published.v1",
  MEMORY_REJECTED: "io.yoizen.agent-memory.memory.rejected.v1",
  MEMORY_EXPIRED: "io.yoizen.agent-memory.memory.expired.v1",
} as const;

export const AGENT_MEMORY_SUBJECT_PREFIX =
  "evt.{tenant}.agent-memory-service.agent-memory.platform.internal";

export const AGENT_MEMORY_PROPOSED =
  `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_proposed.v1`;
export const AGENT_MEMORY_PUBLISHED =
  `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_published.v1`;
export const AGENT_MEMORY_REJECTED =
  `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_rejected.v1`;
export const AGENT_MEMORY_EXPIRED =
  `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_expired.v1`;

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
    private readonly maxReconnectAttempts = NATS_MAX_RECONNECT_ATTEMPTS,
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
    if (this.jsm) return this.jsm;
    const nc = await this.getConnection();
    this.jsm = await nc.jetstreamManager();
    return this.jsm;
  }

  async jetstream(): Promise<JetStreamClient> {
    if (this.jsc) return this.jsc;
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
    if (nc) await nc.close();
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
  occurredAt: string,
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
  options: IBuildEventOptions,
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
      },
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
    producer: PLATFORM_PRODUCER,
    domain: PLATFORM_DOMAIN,
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
  private readonly ensuredStreams = new Map<string, TenantTier>();

  constructor(
    @Inject(LAZY_NATS)
    private readonly lazyNats: LazyNatsConnection,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.lazyNats.close();
  }

  private async ensureTenantStream(tenantId: string): Promise<void> {
    if (this.ensuredStreams.has(tenantId)) {
      return;
    }

    this.logger.log(`Ensuring stream for tenant '${tenantId}'...`);

    const tier: TenantTier = "free";
    this.logger.warn(
      `No tier registered for tenant '${tenantId}'; ` +
        `using fallback tier '${tier}'. ` +
        "Stream should be pre-provisioned via " +
        "TenantProvisioningService.",
    );

    const config = buildTenantStreamConfig(tenantId, tier);

    let jsm: JetStreamManager;
    try {
      jsm = await this.lazyNats.jetstreamManager();
    } catch (jsmErr: unknown) {
      const msg = jsmErr instanceof Error ? jsmErr.message : String(jsmErr);
      this.logger.error(`Failed to get JetStreamManager: ${msg}`);
      throw jsmErr;
    }

    try {
      await jsm.streams.info(config.name);
      this.logger.log(
        `Stream '${config.name}' already exists for tenant '${tenantId}'`,
      );
    } catch {
      this.logger.log(
        `Stream '${config.name}' not found, creating ` +
          `with subjects: ${JSON.stringify(config.subjects)}`,
      );

      const info = await jsm.getAccountInfo();
      const check = checkJetStreamCapacity(
        config.limits.max_bytes,
        info.storage,
        info.limits.max_storage,
      );
      if (!check.ok) {
        this.logger.error(check.message);
        throw new ServiceUnavailableException(check.message);
      }

      try {
        await jsm.streams.add({
          name: config.name,
          subjects: config.subjects,
          max_age: config.limits.max_age,
          max_bytes: config.limits.max_bytes,
          max_msg_size: config.limits.max_msg_size,
          num_replicas: config.limits.num_replicas,
          retention: RetentionPolicy.Limits,
          storage: StorageType.File,
        });
        this.logger.log(
          `Auto-created stream '${config.name}' for tenant '${tenantId}'`,
        );
      } catch (createErr: unknown) {
        const msg =
          createErr instanceof Error ? createErr.message : String(createErr);
        this.logger.error(
          `Failed to create stream '${config.name}': ${msg}`,
        );
        throw createErr;
      }
    }

    this.ensuredStreams.set(tenantId, tier);
  }

  private async publishEvent(
    tenantId: string,
    subjectTemplate: string,
    event: EventEnvelope,
  ): Promise<PubAck | null> {
    const subject = buildPlatformSubject(subjectTemplate, tenantId);

    try {
      await this.ensureTenantStream(tenantId);
      const js = await this.lazyNats.jetstream();

      const hdrs = natsHeaders();
      hdrs.set("Nats-Msg-Id", event.idempotencykey);
      hdrs.set("X-Correlation-Id", event.correlation_id);
      if (event.causation_id) hdrs.set("X-Causation-Id", event.causation_id);
      injectTraceContext(hdrs);

      const { span } = startNatsProducerSpan(
        "agent-memory-service",
        subject,
        hdrs,
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
          "debug",
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
        "error",
      );
      throw error;
    }
  }

  async publishMemoryProposed(tenantId: string, memory: IMemory): Promise<void> {
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
  }

  async publishMemoryApproved(tenantId: string, memory: IMemory): Promise<void> {
    const publishedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `memory:${memory.id}`,
      causationId: null,
      depth: 0,
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

  async publishMemoryRejected(tenantId: string, memory: IMemory): Promise<void> {
    const rejectedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `memory:${memory.id}`,
      causationId: null,
      depth: 0,
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
    causal?: ICausalContext,
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
