import { createHash } from "node:crypto";
import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  type PubAck,
} from "nats";
import {
  Injectable,
  Logger,
  Inject,
  type FactoryProvider,
} from "@nestjs/common";
import {
  STREAM_NAME,
  STREAM_SUBJECTS,
  STREAM_MAX_AGE_NS,
  STREAM_MAX_BYTES,
  SUBJECT_PREFIX,
} from '@yoizen/shared';
import type { EventEnvelope, EventData, EventTransport } from '@yoizen/shared';

export const NATS_CONNECTION = 'NATS_CONNECTION';
export const JETSTREAM_MANAGER = 'JETSTREAM_MANAGER';
export const JETSTREAM_CLIENT = 'JETSTREAM_CLIENT';

const createNatsConnection = async (): Promise<NatsConnection> => {
  const url = process.env.NATS_URL ?? 'nats://localhost:4222';
  return connect({ servers: url });
};

export const natsProvider: FactoryProvider = {
  provide: NATS_CONNECTION,
  useFactory: createNatsConnection,
};

async function ensureStream(
  jsm: JetStreamManager,
  name: string,
  subjects: readonly string[],
  opts?: { max_age?: number; max_bytes?: number },
): Promise<void> {
  try {
    await jsm.streams.info(name);
  } catch {
    await jsm.streams.add({
      name,
      subjects: [...subjects],
      ...opts,
    });
  }
}

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (nc: NatsConnection): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();
    await ensureStream(jsm, STREAM_NAME, STREAM_SUBJECTS, {
      max_age: STREAM_MAX_AGE_NS,
      max_bytes: STREAM_MAX_BYTES,
    });
    return jsm;
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

const DEFAULT_TRANSPORT: EventTransport = {
  method: "stream",
  protocol: "internal",
};

function buildEventData(payload: Record<string, unknown>): EventData {
  const json = JSON.stringify(payload);
  return {
    received_at: new Date().toISOString(),
    payload_inline: true,
    payload_ref: null,
    payload_bytes: Buffer.byteLength(json, "utf-8"),
    payload_checksum: createHash("sha256")
      .update(json)
      .digest("hex"),
    payload,
  };
}

function buildEventEnvelope(
  tenantId: string,
  eventType: string,
  domain: string,
  channel: string,
  provider: string,
  payload: Record<string, unknown>,
): EventEnvelope {
  return {
    specversion: "1.0",
    id: crypto.randomUUID(),
    source: "admin-service",
    type: eventType,
    resource: `${domain}/${channel}`,
    time: new Date().toISOString(),
    traceid: crypto.randomUUID(),
    causation_id: null,
    correlation_id: crypto.randomUUID(),
    tenant: tenantId,
    producer: "yoizenclaw-admin-service",
    domain,
    channel,
    provider,
    accountid: tenantId,
    idempotencykey: crypto.randomUUID(),
    transport: DEFAULT_TRANSPORT,
    data: buildEventData(payload),
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
    subject: string,
    event: EventEnvelope,
  ): Promise<PubAck | null> {
    try {
      const ack = await this.js.publish(subject, JSON.stringify(event), {
        msgID: event.id,
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
    const event = buildEventEnvelope(
      tenantId,
      "agent.published",
      "agent",
      "admin",
      "internal",
      {
        agentId,
        name,
        publishedAt: new Date().toISOString(),
        status: "published",
      },
    );
    return this.publishEvent(`${SUBJECT_PREFIX}agent.published`, event);
  }

  async publishAgentUnpublished(
    tenantId: string,
    agentId: string,
    name: string,
  ): Promise<PubAck | null> {
    const event = buildEventEnvelope(
      tenantId,
      "agent.unpublished",
      "agent",
      "admin",
      "internal",
      {
        agentId,
        name,
        unpublishedAt: new Date().toISOString(),
        status: "draft",
      },
    );
    return this.publishEvent(`${SUBJECT_PREFIX}agent.unpublished`, event);
  }

  async publishCredentialRotated(
    tenantId: string,
    credentialId: string,
    credentialType: string,
  ): Promise<PubAck | null> {
    const event = buildEventEnvelope(
      tenantId,
      "credential.rotated",
      "credential",
      "admin",
      "internal",
      {
        credentialId,
        type: credentialType,
        rotatedAt: new Date().toISOString(),
      },
    );
    return this.publishEvent(
      `${SUBJECT_PREFIX}credential.rotated`,
      event,
    );
  }

  async publishRuntimeConfigSync(
    tenantId: string,
    files: Array<{ path: string; content: string; format: string }>,
    deletePaths: string[] = [],
  ): Promise<PubAck | null> {
    const event = buildEventEnvelope(
      tenantId,
      "runtime.config.sync",
      "runtime",
      "config",
      "internal",
      {
        files,
        deletePaths,
        syncedAt: new Date().toISOString(),
      },
    );
    return this.publishEvent(
      `${SUBJECT_PREFIX}runtime.config.sync`,
      event,
    );
  }

  async publishRuntimeJobsSync(
    tenantId: string,
    jobs: Array<{ id: string; name: string; agentId: string; schedule: string }>,
  ): Promise<PubAck | null> {
    const event = buildEventEnvelope(
      tenantId,
      "runtime.jobs.sync",
      "runtime",
      "jobs",
      "internal",
      {
        jobs,
        syncedAt: new Date().toISOString(),
      },
    );
    return this.publishEvent(
      `${SUBJECT_PREFIX}runtime.jobs.sync`,
      event,
    );
  }

  async publishJobTrigger(
    tenantId: string,
    jobId: string,
    executionId: string,
    eventPayload: Record<string, unknown>,
  ): Promise<PubAck | null> {
    const event = buildEventEnvelope(
      tenantId,
      "job.trigger",
      "job",
      "admin",
      "internal",
      {
        jobId,
        executionId,
        eventPayload,
        triggeredAt: new Date().toISOString(),
      },
    );
    return this.publishEvent(`${SUBJECT_PREFIX}job.trigger`, event);
  }
}
