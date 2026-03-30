import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  type PubAck,
} from 'nats';
import {
  Injectable,
  Logger,
  Inject,
  type FactoryProvider,
} from '@nestjs/common';
import {
  STREAM_NAME,
  STREAM_SUBJECTS,
  STREAM_MAX_AGE_NS,
  STREAM_MAX_BYTES,
  SUBJECT_PREFIX,
} from '@yoizen/shared';
import type { EventEnvelope } from '@yoizen/shared';

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

@Injectable()
export class NatsPublisher {
  private readonly logger = new Logger(NatsPublisher.name);

  constructor(
    @Inject(JETSTREAM_CLIENT)
    private readonly js: JetStreamClient,
  ) {}

  /**
   * Publica un evento al stream EVENTS de NATS JetStream.
   */
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

  /**
   * Emite evento agent.published cuando un agent se publica.
   */
  async publishAgentPublished(
    tenantId: string,
    agentId: string,
    name: string,
  ): Promise<PubAck | null> {
    const event: EventEnvelope = {
      id: crypto.randomUUID(),
      type: 'agent.published',
      payload: {
        agentId,
        name,
        publishedAt: new Date().toISOString(),
        status: 'published',
      },
      metadata: {
        tenantId,
        source: 'admin-service',
        receivedAt: Date.now(),
      },
    };
    return this.publishEvent(`${SUBJECT_PREFIX}.agent.published`, event);
  }

  /**
   * Emite evento agent.unpublished cuando un agent se despublica.
   */
  async publishAgentUnpublished(
    tenantId: string,
    agentId: string,
    name: string,
  ): Promise<PubAck | null> {
    const event: EventEnvelope = {
      id: crypto.randomUUID(),
      type: 'agent.unpublished',
      payload: {
        agentId,
        name,
        unpublishedAt: new Date().toISOString(),
        status: 'draft',
      },
      metadata: {
        tenantId,
        source: 'admin-service',
        receivedAt: Date.now(),
      },
    };
    return this.publishEvent(`${SUBJECT_PREFIX}.agent.unpublished`, event);
  }

  /**
   * Emite evento credential.rotated cuando se rota una credencial.
   */
  async publishCredentialRotated(
    tenantId: string,
    credentialId: string,
    credentialType: string,
  ): Promise<PubAck | null> {
    const event: EventEnvelope = {
      id: crypto.randomUUID(),
      type: 'credential.rotated',
      payload: {
        credentialId,
        type: credentialType,
        rotatedAt: new Date().toISOString(),
      },
      metadata: {
        tenantId,
        source: 'admin-service',
        receivedAt: Date.now(),
      },
    };
    return this.publishEvent(`${SUBJECT_PREFIX}.credential.rotated`, event);
  }

  /**
   * Emite evento runtime.config.sync para sincronizar config files al runtime.
   */
  async publishRuntimeConfigSync(
    tenantId: string,
    files: Array<{ path: string; content: string; format: string }>,
    deletePaths: string[] = [],
  ): Promise<PubAck | null> {
    const event: EventEnvelope = {
      id: crypto.randomUUID(),
      type: 'runtime.config.sync',
      payload: {
        files,
        deletePaths,
        syncedAt: new Date().toISOString(),
      },
      metadata: {
        tenantId,
        source: 'admin-service',
        receivedAt: Date.now(),
      },
    };
    return this.publishEvent(`${SUBJECT_PREFIX}.runtime.config.sync`, event);
  }

  /**
   * Emite evento runtime.jobs.sync para sincronizar jobs al runtime.
   */
  async publishRuntimeJobsSync(
    tenantId: string,
    jobs: Array<{ id: string; name: string; agentId: string; schedule: string }>,
  ): Promise<PubAck | null> {
    const event: EventEnvelope = {
      id: crypto.randomUUID(),
      type: 'runtime.jobs.sync',
      payload: {
        jobs,
        syncedAt: new Date().toISOString(),
      },
      metadata: {
        tenantId,
        source: 'admin-service',
        receivedAt: Date.now(),
      },
    };
    return this.publishEvent(`${SUBJECT_PREFIX}.runtime.jobs.sync`, event);
  }

  /**
   * Emite evento job.trigger para ejecutar un job manualmente.
   */
  async publishJobTrigger(
    tenantId: string,
    jobId: string,
    executionId: string,
    eventPayload: Record<string, unknown>,
  ): Promise<PubAck | null> {
    const event: EventEnvelope = {
      id: crypto.randomUUID(),
      type: 'job.trigger',
      payload: {
        jobId,
        executionId,
        eventPayload,
        triggeredAt: new Date().toISOString(),
      },
      metadata: {
        tenantId,
        source: 'admin-service',
        receivedAt: Date.now(),
      },
    };
    return this.publishEvent(`${SUBJECT_PREFIX}.job.trigger`, event);
  }
}
