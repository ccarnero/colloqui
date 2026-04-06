import { randomBytes, randomUUID } from "node:crypto";
import {
  connect,
  RetentionPolicy,
  StorageType,
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
import { PinoLoggerService } from "@yoizen/observability";
import {
  YOIZENCLAW_ACCOUNT_ID,
  YOIZENCLAW_AGENT_PUBLISHED,
  YOIZENCLAW_AGENT_UNPUBLISHED,
  YOIZENCLAW_CHANNEL,
  YOIZENCLAW_CONFIG_SYNC,
  YOIZENCLAW_CREDENTIAL_ROTATED,
  YOIZENCLAW_DOMAIN,
  YOIZENCLAW_JOB_TRIGGER,
  YOIZENCLAW_PRODUCER,
  YOIZENCLAW_PROVIDER,
  buildYoizenClawSubject,
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
import { yoizenclawAdminServiceConfig } from "../config";

const DEFAULT_TRANSPORT: EventTransport = {
  method: "agent",
  protocol: "internal",
  agent_id: "yoizenclaw-admin-service",
  depth: 0,
};

const EVENT_TYPES = {
  AGENT_PUBLISHED: "io.yoizen.yoizenclaw.admin.agent.published.v1",
  AGENT_UNPUBLISHED: "io.yoizen.yoizenclaw.admin.agent.unpublished.v1",
  CREDENTIAL_ROTATED: "io.yoizen.yoizenclaw.admin.credential.rotated.v1",
  RUNTIME_CONFIG_SYNC: "io.yoizen.yoizenclaw.runtime.config.synced.v1",
  JOB_TRIGGER: "io.yoizen.yoizenclaw.admin.job.triggered.v1",
} as const;

interface IBuildEventOptions {
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  resource: string;
  correlationId: string;
  source: string;
}

const NATS_CONNECT_TIMEOUT_MS = 10_000;
const NATS_MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Lazy NATS connection wrapper. Defers the TCP handshake until
 * the first publish so the HTTP server can start even when NATS
 * is temporarily unavailable.
 */
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
    if (nc) await nc.close();
  }
}

export const LAZY_NATS = "LAZY_NATS";

export const lazyNatsProvider: FactoryProvider<LazyNatsConnection> = {
  provide: LAZY_NATS,
  useFactory: (): LazyNatsConnection => {
    return new LazyNatsConnection(yoizenclawAdminServiceConfig.natsUrl);
  },
};

function createTraceId(): string {
  return randomBytes(16).toString("hex");
}

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
  const eventId = randomUUID();
  const data = buildEventData(options.payload, options.occurredAt);

  return {
    specversion: "1.0",
    id: eventId,
    source: options.source,
    type: options.eventType,
    resource: options.resource,
    time: options.occurredAt,
    traceid: createTraceId(),
    causation_id: null,
    correlation_id: options.correlationId,
    tenant: tenantId,
    producer: YOIZENCLAW_PRODUCER,
    domain: YOIZENCLAW_DOMAIN,
    channel: YOIZENCLAW_CHANNEL,
    provider: YOIZENCLAW_PROVIDER,
    accountid: YOIZENCLAW_ACCOUNT_ID,
    idempotencykey: calculateChecksum(options.payload),
    transport: DEFAULT_TRANSPORT,
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
        `Stream '${config.name}' already exists ` + `for tenant '${tenantId}'`,
      );
    } catch {
      this.logger.log(
        `Stream '${config.name}' not found, creating ` +
          `with subjects: ` +
          `${JSON.stringify(config.subjects)}`,
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
          `Auto-created stream '${config.name}' ` + `for tenant '${tenantId}'`,
        );
      } catch (createErr: unknown) {
        const msg =
          createErr instanceof Error ? createErr.message : String(createErr);
        this.logger.error(
          `Failed to create stream ` + `'${config.name}': ${msg}`,
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
    const subject = buildYoizenClawSubject(subjectTemplate, tenantId);

    try {
      await this.ensureTenantStream(tenantId);
      const js = await this.lazyNats.jetstream();
      const ack = await js.publish(subject, JSON.stringify(event), {
        msgID: event.idempotencykey,
      });
      this.logger.debug(`Published event to ${subject}: ${event.type}`);
      return ack;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to publish event to ${subject}: ${msg}`);
      throw error;
    }
  }

  async publishAgentPublished(
    tenantId: string,
    agentId: string,
    name: string,
  ): Promise<PubAck | null> {
    const publishedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `agent:${agentId}`,
      eventType: EVENT_TYPES.AGENT_PUBLISHED,
      occurredAt: publishedAt,
      payload: {
        agentId,
        name,
        publishedAt,
        status: "published",
      },
      resource: `tenant/${tenantId}/agents/${agentId}`,
      source: "//yoizenclaw-admin-service/admin/agents/publish",
    });

    return this.publishEvent(tenantId, YOIZENCLAW_AGENT_PUBLISHED, event);
  }

  async publishAgentUnpublished(
    tenantId: string,
    agentId: string,
    name: string,
  ): Promise<PubAck | null> {
    const unpublishedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `agent:${agentId}`,
      eventType: EVENT_TYPES.AGENT_UNPUBLISHED,
      occurredAt: unpublishedAt,
      payload: {
        agentId,
        name,
        status: "draft",
        unpublishedAt,
      },
      resource: `tenant/${tenantId}/agents/${agentId}`,
      source: "//yoizenclaw-admin-service/admin/agents/unpublish",
    });

    return this.publishEvent(tenantId, YOIZENCLAW_AGENT_UNPUBLISHED, event);
  }

  async publishCredentialRotated(
    tenantId: string,
    credentialId: string,
    credentialType: string,
  ): Promise<PubAck | null> {
    const rotatedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `credential:${credentialId}`,
      eventType: EVENT_TYPES.CREDENTIAL_ROTATED,
      occurredAt: rotatedAt,
      payload: {
        credentialId,
        rotatedAt,
        type: credentialType,
      },
      resource: `tenant/${tenantId}/credentials/${credentialId}`,
      source: "//yoizenclaw-admin-service/admin/credentials/rotate",
    });

    return this.publishEvent(tenantId, YOIZENCLAW_CREDENTIAL_ROTATED, event);
  }

  async publishRuntimeConfigSync(
    tenantId: string,
    files: Array<{ content: string; format: string; path: string }>,
    deletePaths: string[] = [],
  ): Promise<PubAck | null> {
    const syncedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `runtime:${tenantId}:config`,
      eventType: EVENT_TYPES.RUNTIME_CONFIG_SYNC,
      occurredAt: syncedAt,
      payload: {
        action_type: "config_sync",
        deletePaths,
        files,
        syncedAt,
      },
      resource: `tenant/${tenantId}/runtime/config`,
      source: "//yoizenclaw-admin-service/admin/config-files/deploy",
    });

    return this.publishEvent(tenantId, YOIZENCLAW_CONFIG_SYNC, event);
  }

  async publishJobTrigger(options: {
    tenantId: string;
    jobId: string;
    executionId: string;
    eventPayload: Record<string, unknown>;
  }): Promise<PubAck | null> {
    const { tenantId, jobId, executionId, eventPayload } = options;
    const triggeredAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `job:${jobId}:execution:${executionId}`,
      eventType: EVENT_TYPES.JOB_TRIGGER,
      occurredAt: triggeredAt,
      payload: {
        action_type: "job_trigger",
        eventPayload,
        executionId,
        jobId,
        triggeredAt,
      },
      resource: `tenant/${tenantId}/jobs/${jobId}/executions/${executionId}`,
      source: "//yoizenclaw-admin-service/admin/jobs/trigger",
    });

    return this.publishEvent(tenantId, YOIZENCLAW_JOB_TRIGGER, event);
  }
}
