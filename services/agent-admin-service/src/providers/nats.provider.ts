import { randomUUID } from "node:crypto";
import {
  type FactoryProvider,
  Inject,
  Injectable,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  activeOrRandomTraceId,
  injectTraceContext,
  logWithEnvelope,
  PinoLoggerService,
  startNatsProducerSpan,
} from "@yoizen/observability";
import type { EventData, EventEnvelope, EventTransport } from "@yoizen/shared";
import {
  buildPlatformSubject,
  buildTenantStreamConfig,
  checkJetStreamCapacity,
  DepthExceededError,
  MAX_DEPTH_BY_CATEGORY,
  PLATFORM_ACCOUNT_ID,
  PLATFORM_AGENT_PUBLISHED,
  PLATFORM_AGENT_UNPUBLISHED,
  PLATFORM_CHANNEL,
  PLATFORM_CONFIG_SYNC,
  PLATFORM_DOCUMENT_INGESTION,
  PLATFORM_DOMAIN,
  PLATFORM_JOB_TRIGGER,
  PLATFORM_PRODUCER,
  PLATFORM_PROVIDER,
  PLATFORM_SKB_FILE_INGESTION,
  PLATFORM_SUBJECT_PREFIX,
  type TenantTier,
} from "@yoizen/shared";
import {
  connect,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  headers as natsHeaders,
  type PubAck,
  RetentionPolicy,
  StorageType,
} from "nats";
import { agentAdminServiceConfig } from "../config";
import {
  calculateChecksum,
  serializeCanonicalPayload,
} from "../utils/payload-utils";

const DEFAULT_TRANSPORT: EventTransport = {
  method: "agent",
  protocol: "internal",
  agent_id: "agent-admin-service",
  depth: 0,
};

const EVENT_TYPES = {
  AGENT_PUBLISHED: "io.yoizen.platform.admin.agent.published.v1",
  AGENT_UNPUBLISHED: "io.yoizen.platform.admin.agent.unpublished.v1",
  RUNTIME_CONFIG_SYNC: "io.yoizen.platform.runtime.config.synced.v1",
  JOB_TRIGGER: "io.yoizen.platform.admin.job.triggered.v1",
  DOCUMENT_INGESTION: "io.yoizen.platform.admin.document.ingestion.v1",
  SKILL_CHANGED: "io.yoizen.platform.admin.skill_changed.v1",
  SKB_FILE_INGESTION: "io.yoizen.platform.admin.skb_file_ingestion.v1",
} as const;

const PLATFORM_SKILL_CHANGED = `${PLATFORM_SUBJECT_PREFIX}.skill_changed.v1`;

interface IBuildEventOptions {
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  resource: string;
  correlationId: string;
  source: string;
  /** Optional causation id for cascaded events (DOCS/messaging/envelope.md §6). */
  causationId?: string | null;
  /** Optional causal depth (DOCS/messaging/envelope.md §6.3). Defaults to 0. */
  depth?: number;
}

const NATS_CONNECT_TIMEOUT_MS = 10_000;
const NATS_MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Lazy NATS connection wrapper. Defers the TCP handshake until
 * the first publish so the HTTP server can start even when NATS
 * is temporarily unavailable.
 */
export class LazyNatsConnection {
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
        name: "agent-admin-service",
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
    // Ensure JSM is initialized first
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
    return new LazyNatsConnection(agentAdminServiceConfig.natsUrl);
  },
};

export const JETSTREAM_MANAGER = "AGENT_ADMIN_SERVICE_JETSTREAM_MANAGER";
export const JETSTREAM = "AGENT_ADMIN_SERVICE_JETSTREAM";

export const jetStreamManagerProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [LAZY_NATS],
  useFactory: (lazyNats: LazyNatsConnection) => lazyNats.jetstreamManager(),
} satisfies FactoryProvider<Promise<JetStreamManager>>;

export const jetStreamClientProvider = {
  provide: JETSTREAM,
  inject: [LAZY_NATS],
  useFactory: (lazyNats: LazyNatsConnection) => lazyNats.jetstream(),
} satisfies FactoryProvider<Promise<JetStreamClient>>;

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

@Injectable()
export class NatsPublisher implements OnModuleDestroy {
  private readonly logger = new PinoLoggerService(NatsPublisher.name);
  private readonly ensuredStreams = new Map<string, TenantTier>();

  constructor(
    @Inject(LAZY_NATS)
    private readonly lazyNats: LazyNatsConnection,
  ) {}

  /**
   * Closes the lazy NATS connection on application shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    await this.lazyNats.close();
  }

  /**
   * Auto-ensures the tenant JetStream stream exists before
   * the first publish per tenant. Idempotent — skips if the
   * stream is already known or already exists in NATS.
   *
   * Uses fallback tier "free" and logs a warning; stream should
   * be pre-provisioned via TenantProvisioningService when possible.
   */
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
        "TenantProvisioningService."
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
        `Stream '${config.name}' already exists ` + `for tenant '${tenantId}'`
      );
    } catch {
      this.logger.log(
        `Stream '${config.name}' not found, creating ` +
          `with subjects: ` +
          `${JSON.stringify(config.subjects)}`
      );

      const info = await jsm.getAccountInfo();
      const check = checkJetStreamCapacity(
        config.limits.max_bytes,
        info.storage,
        info.limits.max_storage
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
          `Auto-created stream '${config.name}' ` + `for tenant '${tenantId}'`
        );
      } catch (createErr: unknown) {
        const msg =
          createErr instanceof Error ? createErr.message : String(createErr);
        this.logger.error(
          `Failed to create stream ` + `'${config.name}': ${msg}`
        );
        throw createErr;
      }
    }

    this.ensuredStreams.set(tenantId, tier);
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
        "agent-admin-service",
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
          "platform.publish.ok",
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
        "platform.publish.error",
        `Failed to publish event to ${subject}: ${msg}`,
        "error"
      );
      throw error;
    }
  }

  async publishAgentPublished(
    tenantId: string,
    agentId: string,
    name: string,
    agent?: {
      system_prompt: string;
      model_config: Record<string, unknown>;
      tools: unknown[];
      channels: unknown[];
      description?: string;
    },
    causal?: ICausalContext
  ): Promise<PubAck | null> {
    const publishedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: causal?.correlationId ?? `agent:${agentId}`,
      causationId: causal?.causationId ?? null,
      depth: causal ? (causal.incomingDepth ?? 0) + 1 : 0,
      eventType: EVENT_TYPES.AGENT_PUBLISHED,
      occurredAt: publishedAt,
      payload: {
        agentId,
        name,
        publishedAt,
        status: "published",
        ...(agent && {
          system_prompt: agent.system_prompt,
          model_config: agent.model_config,
          tools: agent.tools,
          channels: agent.channels,
          description: agent.description,
        }),
      },
      resource: `tenant/${tenantId}/agents/${agentId}`,
      source: "//agent-admin-service/admin/agents/publish",
    });

    return this.publishEvent(tenantId, PLATFORM_AGENT_PUBLISHED, event);
  }

  async publishAgentUnpublished(
    tenantId: string,
    agentId: string,
    name: string,
    causal?: ICausalContext
  ): Promise<PubAck | null> {
    const unpublishedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: causal?.correlationId ?? `agent:${agentId}`,
      causationId: causal?.causationId ?? null,
      depth: causal ? (causal.incomingDepth ?? 0) + 1 : 0,
      eventType: EVENT_TYPES.AGENT_UNPUBLISHED,
      occurredAt: unpublishedAt,
      payload: {
        agentId,
        name,
        status: "draft",
        unpublishedAt,
      },
      resource: `tenant/${tenantId}/agents/${agentId}`,
      source: "//agent-admin-service/admin/agents/unpublish",
    });

    return this.publishEvent(tenantId, PLATFORM_AGENT_UNPUBLISHED, event);
  }

  async publishRuntimeConfigSync(
    tenantId: string,
    files: Array<{ content: string; format: string; path: string }>,
    deletePaths: string[] = [],
    causal?: ICausalContext
  ): Promise<PubAck | null> {
    const syncedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: causal?.correlationId ?? `runtime:${tenantId}:config`,
      causationId: causal?.causationId ?? null,
      depth: causal ? (causal.incomingDepth ?? 0) + 1 : 0,
      eventType: EVENT_TYPES.RUNTIME_CONFIG_SYNC,
      occurredAt: syncedAt,
      payload: {
        action_type: "config_sync",
        deletePaths,
        files,
        syncedAt,
      },
      resource: `tenant/${tenantId}/runtime/config`,
      source: "//agent-admin-service/admin/config-files/deploy",
    });

    return this.publishEvent(tenantId, PLATFORM_CONFIG_SYNC, event);
  }

  async publishJobTrigger(options: {
    tenantId: string;
    jobId: string;
    executionId: string;
    eventPayload: Record<string, unknown>;
    causal?: ICausalContext;
  }): Promise<PubAck | null> {
    const { tenantId, jobId, executionId, eventPayload, causal } = options;
    const triggeredAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId:
        causal?.correlationId ?? `job:${jobId}:execution:${executionId}`,
      causationId: causal?.causationId ?? null,
      depth: causal ? (causal.incomingDepth ?? 0) + 1 : 0,
      eventType: EVENT_TYPES.JOB_TRIGGER,
      occurredAt: triggeredAt,
      payload: {
        action_type: "job_trigger",
        event_payload: eventPayload,
        execution_id: executionId,
        job_id: jobId,
        triggered_at: triggeredAt,
      },
      resource: `tenant/${tenantId}/jobs/${jobId}/executions/${executionId}`,
      source: "//agent-admin-service/admin/jobs/trigger",
    });

    return this.publishEvent(tenantId, PLATFORM_JOB_TRIGGER, event);
  }

  async publishDocumentIngestion(
    tenantId: string,
    kbId: string,
    payload: {
      documentId: string;
      filename: string;
      contentType: string;
      fileBase64?: string;
    }
  ): Promise<PubAck | null> {
    const occurredAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `document:${payload.documentId}`,
      eventType: EVENT_TYPES.DOCUMENT_INGESTION,
      occurredAt,
      payload: {
        documentId: payload.documentId,
        tenantId,
        kbId,
        filename: payload.filename,
        contentType: payload.contentType,
        ...(payload.fileBase64 ? { fileBase64: payload.fileBase64 } : {}),
      },
      resource: `tenant/${tenantId}/knowledge-bases/${kbId}/documents/${payload.documentId}`,
      source:
        "//agent-admin-service/admin/knowledge-bases/documents/upload-file",
    });

    return this.publishEvent(tenantId, PLATFORM_DOCUMENT_INGESTION, event);
  }

  /**
   * Publishes the event consumed by SKBIngestionWorkerService
   * (structured-kb/skb-ingestion-worker.service.ts). `fileUrl` carries the
   * base64-encoded file content directly — the worker's SKBFileParser
   * decodes it with `Buffer.from(fileUrl, "base64")`, there is no separate
   * blob store to fetch from.
   */
  async publishSkbFileIngestion(
    tenantId: string,
    payload: {
      containerId: string;
      fileId: string;
      fileBase64: string;
      categories: string[];
      sheetName?: string | null;
    }
  ): Promise<PubAck | null> {
    const occurredAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `skb-file:${payload.fileId}`,
      eventType: EVENT_TYPES.SKB_FILE_INGESTION,
      occurredAt,
      payload: {
        containerId: payload.containerId,
        fileId: payload.fileId,
        tenantId,
        fileUrl: payload.fileBase64,
        categories: payload.categories,
        sheetName: payload.sheetName ?? null,
      },
      resource: `tenant/${tenantId}/structured-kb/containers/${payload.containerId}/files/${payload.fileId}`,
      source:
        "//agent-admin-service/admin/structured-kb/containers/files/upload",
    });

    return this.publishEvent(tenantId, PLATFORM_SKB_FILE_INGESTION, event);
  }

  async publishSkillChanged(
    tenantId: string,
    skillId: string,
    action: "created" | "updated" | "deleted",
    skill?: Record<string, unknown>,
    causal?: ICausalContext
  ): Promise<PubAck | null> {
    const occurredAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId:
        causal?.correlationId ?? `skill:${skillId}:${action}:${occurredAt}`,
      causationId: causal?.causationId ?? null,
      depth: causal ? (causal.incomingDepth ?? 0) + 1 : 0,
      eventType: EVENT_TYPES.SKILL_CHANGED,
      occurredAt,
      payload: {
        action,
        skillId,
        ...(skill ? { skill } : {}),
      },
      resource: `tenant/${tenantId}/skills/${skillId}`,
      source: "//agent-admin-service/admin/skills",
    });

    return this.publishEvent(tenantId, PLATFORM_SKILL_CHANGED, event);
  }
}

/**
 * Causal context accepted by the `publish*` helpers. Used to chain
 * derived events to the request that triggered them (DOCS/messaging/envelope.md §6).
 */
export interface ICausalContext {
  readonly causationId?: string | null;
  readonly correlationId?: string;
  readonly incomingDepth?: number;
}
