import { randomBytes, randomUUID } from "node:crypto";
import {
  connect,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  type PubAck,
} from "nats";
import {
  Inject,
  Injectable,
  Logger,
  type FactoryProvider,
} from "@nestjs/common";
import {
  YOIZENCLAW_ACCOUNT_ID,
  YOIZENCLAW_AGENT_PUBLISHED,
  YOIZENCLAW_AGENT_UNPUBLISHED,
  YOIZENCLAW_CHANNEL,
  YOIZENCLAW_CONFIG_SYNC,
  YOIZENCLAW_CREDENTIAL_ROTATED,
  YOIZENCLAW_DOMAIN,
  YOIZENCLAW_JOB_TRIGGER,
  YOIZENCLAW_JOBS_SYNC,
  YOIZENCLAW_PRODUCER,
  YOIZENCLAW_PROVIDER,
  buildYoizenClawSubject,
} from "@yoizen/shared";
import type { EventData, EventEnvelope, EventTransport } from "@yoizen/shared";
import {
  calculateChecksum,
  serializeCanonicalPayload,
} from "../utils/payload-utils";

export const NATS_CONNECTION = "NATS_CONNECTION";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_CLIENT = "JETSTREAM_CLIENT";

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
  RUNTIME_JOBS_SYNC: "io.yoizen.yoizenclaw.runtime.jobs.synced.v1",
  JOB_TRIGGER: "io.yoizen.yoizenclaw.admin.job.triggered.v1",
} as const;

interface BuildEventOptions {
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  resource: string;
  correlationId: string;
  source: string;
}

const createNatsConnection = async (): Promise<NatsConnection> => {
  const url = process.env.NATS_URL ?? "nats://localhost:4222";
  return connect({ servers: url });
};

export const natsProvider: FactoryProvider = {
  provide: NATS_CONNECTION,
  useFactory: createNatsConnection,
};

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (nc: NatsConnection): Promise<JetStreamManager> => {
    return nc.jetstreamManager();
  },
};

export const jetStreamClientProvider: FactoryProvider = {
  provide: JETSTREAM_CLIENT,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: async (
    nc: NatsConnection,
    _jm: JetStreamManager,
  ): Promise<JetStreamClient> => {
    return nc.jetstream();
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

function buildIdempotencyKey(
  payload: Record<string, unknown>,
): string {
  return calculateChecksum(payload);
}

function buildEventEnvelope(
  tenantId: string,
  options: BuildEventOptions,
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
    idempotencykey: buildIdempotencyKey(options.payload),
    transport: DEFAULT_TRANSPORT,
    data,
  };
}

@Injectable()
export class NatsPublisher {
  private readonly logger = new Logger(NatsPublisher.name);

  constructor(
    @Inject(JETSTREAM_CLIENT)
    private readonly js: JetStreamClient,
  ) {}

  private async publishEvent(
    tenantId: string,
    subjectTemplate: string,
    event: EventEnvelope,
  ): Promise<PubAck | null> {
    const subject = buildYoizenClawSubject(subjectTemplate, tenantId);

    try {
      const ack = await this.js.publish(subject, JSON.stringify(event), {
        msgID: event.idempotencykey,
      });
      this.logger.debug(`Published event to ${subject}: ${event.type}`);
      return ack;
    } catch (error) {
      this.logger.error(`Failed to publish event to ${subject}`, error);
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

  async publishRuntimeJobsSync(
    tenantId: string,
    jobs: Array<{
      agentId: string;
      id: string;
      name: string;
      schedule: string;
    }>,
  ): Promise<PubAck | null> {
    const syncedAt = new Date().toISOString();
    const event = buildEventEnvelope(tenantId, {
      correlationId: `runtime:${tenantId}:jobs`,
      eventType: EVENT_TYPES.RUNTIME_JOBS_SYNC,
      occurredAt: syncedAt,
      payload: {
        action_type: "jobs_sync",
        jobs,
        syncedAt,
      },
      resource: `tenant/${tenantId}/runtime/jobs`,
      source: "//yoizenclaw-admin-service/admin/jobs/sync",
    });

    return this.publishEvent(tenantId, YOIZENCLAW_JOBS_SYNC, event);
  }

  async publishJobTrigger(
    tenantId: string,
    jobId: string,
    executionId: string,
    eventPayload: Record<string, unknown>,
  ): Promise<PubAck | null> {
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
