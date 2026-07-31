import { randomUUID } from "node:crypto";
import {
  connect,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  type PubAck,
  headers as natsHeaders,
} from "nats";
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  type FactoryProvider,
} from "@nestjs/common";
import {
  PinoLoggerService,
  activeOrRandomTraceId,
  injectTraceContext,
  logWithEnvelope,
  startNatsProducerSpan,
} from "@yoizen/observability";
import {
  AGENT_ADMIN_JOB_TRIGGER,
  AGENT_ADMIN_PRODUCER,
  PLATFORM_DOMAIN,
  PLATFORM_CHANNEL,
  PLATFORM_PROVIDER,
  PLATFORM_ACCOUNT_ID,
  buildPlatformSubject,
  type EventEnvelope,
} from "@yoizen/shared";
import { agentSchedulerServiceConfig } from "../config";
import { calculateChecksum, serializeCanonicalPayload } from "../utils/payload-utils";

const NATS_CONNECT_TIMEOUT_MS = 10_000;
const NATS_MAX_RECONNECT_ATTEMPTS = 5;

const EVENT_TYPE_JOB_TRIGGER =
  "io.yoizen.agent-admin-service.job.triggered.v1" as const;

const DEFAULT_TRANSPORT = {
  method: "stream" as const,
  protocol: "internal" as const,
};

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
    if (this.connection) return this.connection;
    if (!this.connectionPromise) {
      this.logger.log(`Connecting to NATS at ${this.servers}...`);
      this.connectionPromise = connect({
        servers: this.servers,
        name: "agent-scheduler-service",
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
export const JETSTREAM = "JETSTREAM";

export const lazyNatsProvider: FactoryProvider<LazyNatsConnection> = {
  provide: LAZY_NATS,
  useFactory: () =>
    new LazyNatsConnection(agentSchedulerServiceConfig.natsUrl),
};

export const jetStreamProvider: FactoryProvider<Promise<JetStreamClient>> = {
  provide: JETSTREAM,
  useFactory: async (lazyNats: LazyNatsConnection): Promise<JetStreamClient> =>
    lazyNats.jetstream(),
  inject: [LAZY_NATS],
};

@Injectable()
export class NatsSchedulerPublisher implements OnModuleDestroy {
  private readonly logger = new PinoLoggerService(NatsSchedulerPublisher.name);

  constructor(
    @Inject(LAZY_NATS) private readonly lazyNats: LazyNatsConnection,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.lazyNats.close();
  }

  async publishJobTrigger(options: {
    tenantId: string;
    jobId: string;
    executionId: string;
    eventPayload: Record<string, unknown>;
  }): Promise<PubAck | null> {
    const { tenantId, jobId, executionId, eventPayload } = options;
    const triggeredAt = new Date().toISOString();
    const eventId = randomUUID();
    const serializedPayload = serializeCanonicalPayload(eventPayload);

    const envelope: EventEnvelope = {
      specversion: "1.0",
      id: eventId,
      source: "//agent-scheduler-service/scheduler/job-trigger",
      type: EVENT_TYPE_JOB_TRIGGER,
      resource: `tenant/${tenantId}/jobs/${jobId}/executions/${executionId}`,
      time: triggeredAt,
      traceid: activeOrRandomTraceId(),
      causation_id: null,
      correlation_id: `job:${jobId}:execution:${executionId}`,
      tenant: tenantId,
      producer: AGENT_ADMIN_PRODUCER,
      domain: PLATFORM_DOMAIN,
      channel: PLATFORM_CHANNEL,
      provider: PLATFORM_PROVIDER,
      accountid: PLATFORM_ACCOUNT_ID,
      idempotencykey: calculateChecksum(eventPayload),
      transport: DEFAULT_TRANSPORT,
      data: {
        received_at: triggeredAt,
        payload_inline: true,
        payload_ref: null,
        payload_bytes: Buffer.byteLength(serializedPayload, "utf-8"),
        payload_checksum: calculateChecksum(eventPayload),
        payload: {
          action_type: "job_trigger",
          eventPayload,
          executionId,
          jobId,
          triggeredAt,
        },
      },
    };

    const subject = buildPlatformSubject(AGENT_ADMIN_JOB_TRIGGER, tenantId);

    try {
      const js = await this.lazyNats.jetstream();

      const hdrs = natsHeaders();
      hdrs.set("Nats-Msg-Id", envelope.idempotencykey);
      hdrs.set("X-Correlation-Id", envelope.correlation_id);
      injectTraceContext(hdrs);

      const { span } = startNatsProducerSpan(
        "agent-scheduler-service",
        subject,
        hdrs,
      );

      try {
        const ack = await js.publish(subject, JSON.stringify(envelope), {
          msgID: envelope.idempotencykey,
          headers: hdrs,
        });
        logWithEnvelope(
          this.logger,
          envelope,
          "scheduler.publish.ok",
          `Published job_trigger to ${subject}`,
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
        envelope,
        "scheduler.publish.error",
        `Failed to publish job_trigger to ${subject}: ${msg}`,
        "error",
      );
      throw error;
    }
  }
}
