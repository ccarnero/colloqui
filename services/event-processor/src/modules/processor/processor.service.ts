import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Consumer, JetStreamClient } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import { headers as natsHeaders } from "nats";
import type Redis from "ioredis";
import {
  RESULT_TTL,
  RESULT_KEY_PREFIX,
  RESULTS_SUBJECT_PREFIX,
  TENANT_HEADER,
} from "@yoizen/shared";
import type {
  EventEnvelope,
  ProcessedEvent,
  CompletionEvent,
} from "@yoizen/shared";
import {
  NatsConsumerRunner,
  REDIS_CLIENT,
} from "@yoizen/database";
import {
  JETSTREAM_CLIENT,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import { ProcessorPipelineDeps } from "./processor-pipeline-deps";
import type { IPipelineContext } from "../../pipeline/pipeline-stage.interface";

/**
 * Consumes JetStream messages, runs the enrichment pipeline, dispatches to
 * type handlers, persists results to Redis, and publishes to RESULTS.
 */
@Injectable()
export class ProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(ProcessorService.name);
  private readonly encoder = new TextEncoder();
  private readonly runner: NatsConsumerRunner;

  constructor(
    @Inject(JETSTREAM_CLIENT) consumer: Consumer,
    @Inject(JETSTREAM_PUBLISHER) private readonly publisher: JetStreamClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly pipelineDeps: ProcessorPipelineDeps,
  ) {
    this.runner = new NatsConsumerRunner(
      consumer,
      (msg) => this.handleMessage(msg),
      this.logger,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.runner.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.runner.stop();
  }

  private async handleMessage(msg: import("nats").JsMsg): Promise<void> {
    const envelope = msg.json() as EventEnvelope;
    const tenantId =
      envelope.tenant || msg.headers?.get(TENANT_HEADER) || undefined;

    const context: IPipelineContext = {
      subject: msg.subject,
      correlationId: msg.headers?.get("X-Correlation-Id") || undefined,
      tenantId,
    };
    const enriched = await this.pipelineDeps.pipeline.run(envelope, context);
    await this.processEvent(enriched, tenantId);
  }

  /**
   * Runs handler for `envelope.type`, stores Redis result, publishes completion.
   * @param envelope - Parsed CloudEvents-shaped body.
   * @param tenantId - Tenant scope from envelope or message headers.
   */
  async processEvent(
    envelope: EventEnvelope,
    tenantId?: string,
  ): Promise<void> {
    const {
      id: eventId,
      type,
      data: envelopeData,
      callback_url,
      adapter_id,
    } = envelope;
    const payload = envelopeData?.payload ?? {};

    const handler =
      this.pipelineDeps.registry.get(type) ?? this.pipelineDeps.defaultHandler;
    const { processed, data } = await handler.handle(eventId, payload);

    const result: ProcessedEvent = {
      eventId,
      type,
      processed,
      timestamp: Date.now(),
      ...(data !== undefined && { data }),
      ...(tenantId && { tenant: tenantId }),
      ...(envelope.correlation_id && {
        correlation_id: envelope.correlation_id,
      }),
    };

    const keyPrefix = tenantId ? `${tenantId}:` : "";
    const key = `${keyPrefix}${RESULT_KEY_PREFIX}${eventId}`;
    const resultJson = JSON.stringify(result);

    const completion: CompletionEvent = {
      eventId,
      type,
      result,
      ...(callback_url && { callback_url }),
      ...(adapter_id && { adapter_id }),
    };
    const completionSubject = `${RESULTS_SUBJECT_PREFIX}.${type}`;

    const hdrs = natsHeaders();
    if (tenantId) hdrs.set(TENANT_HEADER, tenantId);

    await Promise.all([
      this.redis.setex(key, RESULT_TTL, resultJson),
      this.publisher.publish(
        completionSubject,
        this.encoder.encode(JSON.stringify(completion)),
        { headers: hdrs },
      ),
    ]);
  }
}
