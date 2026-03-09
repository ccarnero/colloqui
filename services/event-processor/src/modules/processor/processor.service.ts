import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Consumer, JetStreamClient } from 'nats';
import { headers as natsHeaders } from 'nats';
import type Redis from 'ioredis';
import {
  RESULT_TTL,
  RESULT_KEY_PREFIX,
  RESULTS_SUBJECT_PREFIX,
  TENANT_HEADER,
} from '@yoizen/shared';
import type {
  EventEnvelope,
  ProcessedEvent,
  CompletionEvent,
} from '@yoizen/shared';
import {
  JETSTREAM_CLIENT,
  JETSTREAM_PUBLISHER,
} from '../../providers/nats.provider';
import { REDIS_CLIENT } from '../../providers/redis.provider';
import { HandlerRegistry } from '../../handlers/handler-registry';
import { DefaultHandler } from '../../handlers/default.handler';
import { PipelineRunner } from '../../pipeline/pipeline-runner';
import type { PipelineContext } from '../../pipeline/pipeline-stage.interface';

@Injectable()
export class ProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessorService.name);
  private readonly typeCounts = new Map<string, number>();
  private readonly encoder = new TextEncoder();
  private consumeIterator: Awaited<
    ReturnType<Consumer['consume']>
  > | null = null;

  constructor(
    @Inject(JETSTREAM_CLIENT) private readonly consumer: Consumer,
    @Inject(JETSTREAM_PUBLISHER) private readonly publisher: JetStreamClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly registry: HandlerRegistry,
    private readonly defaultHandler: DefaultHandler,
    private readonly pipeline: PipelineRunner,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumeIterator = await this.consumer.consume({
      max_messages: 100,
      expires: 30_000,
    });
    this.runConsumer();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumeIterator) {
      this.consumeIterator.stop();
      this.consumeIterator = null;
    }
  }

  private async runConsumer(): Promise<void> {
    if (!this.consumeIterator) return;
    try {
      for await (const msg of this.consumeIterator) {
        try {
          const envelope = msg.json() as EventEnvelope;
          const tenantId = envelope.metadata?.tenantId
            ?? msg.headers?.get(TENANT_HEADER)
            ?? undefined;

          const context: PipelineContext = {
            subject: msg.subject,
            correlationId:
              msg.headers?.get('X-Correlation-Id') || undefined,
            tenantId,
          };
          const enriched = await this.pipeline.run(envelope, context);
          await this.processEvent(enriched, tenantId);
          msg.ack();
        } catch (err) {
          this.logger.warn(
            `Failed to process message: ${err instanceof Error ? err.message : err}`,
          );
          msg.nak();
        }
      }
    } catch {
      // iterator stopped
    }
  }

  async processEvent(envelope: EventEnvelope, tenantId?: string): Promise<void> {
    const { id: eventId, type, payload, metadata, callbackUrl } = envelope;

    const count = this.typeCounts.get(type) ?? 0;
    this.typeCounts.set(type, count + 1);

    const handler = this.registry.get(type) ?? this.defaultHandler;
    const { processed, data } = await handler.handle(eventId, payload);

    const result: ProcessedEvent = {
      eventId,
      type,
      processed,
      timestamp: Date.now(),
      ...(data !== undefined && { data }),
      ...(metadata && { metadata }),
    };

    const keyPrefix = tenantId ? `${tenantId}:` : '';
    const key = `${keyPrefix}${RESULT_KEY_PREFIX}${eventId}`;
    const resultJson = JSON.stringify(result);

    const completion: CompletionEvent = {
      eventId,
      type,
      result,
      ...(callbackUrl && { callbackUrl }),
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

  getStats(): Map<string, number> {
    return new Map(this.typeCounts);
  }
}
