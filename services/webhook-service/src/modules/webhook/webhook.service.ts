import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Consumer, JetStreamClient } from 'nats';
import {
  WEBHOOK_DLQ_SUBJECT,
  WEBHOOK_MAX_RETRIES,
  WEBHOOK_RETRY_DELAYS,
  TENANT_HEADER,
} from '@yoizen/shared';
import type { CompletionEvent } from '@yoizen/shared';
import {
  JETSTREAM_CONSUMER,
  JETSTREAM_PUBLISHER,
} from '../../providers/nats.provider';

@Injectable()
export class WebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookService.name);
  private readonly encoder = new TextEncoder();
  private readonly deliveryCounts = new Map<string, number>();
  private consumeIterator: Awaited<
    ReturnType<Consumer['consume']>
  > | null = null;

  constructor(
    @Inject(JETSTREAM_CONSUMER) private readonly consumer: Consumer,
    @Inject(JETSTREAM_PUBLISHER) private readonly publisher: JetStreamClient,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumeIterator = await this.consumer.consume({
      max_messages: 50,
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
          const completion = msg.json() as CompletionEvent;

          if (!completion.callbackUrl) {
            msg.ack();
            continue;
          }

          const tenantId = completion.result?.metadata?.tenantId as string | undefined
            ?? msg.headers?.get(TENANT_HEADER)
            ?? undefined;

          await this.dispatchWithRetry(completion, tenantId);
          msg.ack();
        } catch (err) {
          this.logger.error(
            `Failed to process completion: ${err instanceof Error ? err.message : err}`,
          );
          msg.nak();
        }
      }
    } catch {
      // iterator stopped
    }
  }

  private async dispatchWithRetry(
    completion: CompletionEvent,
    tenantId?: string,
  ): Promise<void> {
    const { eventId, callbackUrl, result } = completion;
    const body = JSON.stringify(result);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (tenantId) headers[TENANT_HEADER] = tenantId;

    for (let attempt = 0; attempt < WEBHOOK_MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(callbackUrl!, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        });

        if (response.ok) {
          this.trackDelivery(eventId, true);
          this.logger.log(
            `Webhook delivered for ${eventId} to ${callbackUrl} (attempt ${attempt + 1})`,
          );
          return;
        }

        this.logger.warn(
          `Webhook attempt ${attempt + 1}/${WEBHOOK_MAX_RETRIES} failed for ${eventId}: HTTP ${response.status}`,
        );
      } catch (err) {
        this.logger.warn(
          `Webhook attempt ${attempt + 1}/${WEBHOOK_MAX_RETRIES} failed for ${eventId}: ${err instanceof Error ? err.message : err}`,
        );
      }

      if (attempt < WEBHOOK_MAX_RETRIES - 1) {
        await this.sleep(WEBHOOK_RETRY_DELAYS[attempt]);
      }
    }

    this.trackDelivery(eventId, false);
    this.logger.error(
      `Webhook delivery exhausted for ${eventId}, publishing to DLQ`,
    );

    await this.publisher.publish(
      WEBHOOK_DLQ_SUBJECT,
      this.encoder.encode(JSON.stringify(completion)),
    );
  }

  private trackDelivery(eventId: string, success: boolean): void {
    const count = (this.deliveryCounts.get(eventId) ?? 0) + 1;
    this.deliveryCounts.set(eventId, count);

    if (this.deliveryCounts.size > 10_000) {
      const firstKey = this.deliveryCounts.keys().next().value;
      if (firstKey !== undefined) this.deliveryCounts.delete(firstKey);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getDeliveryCounts(): Map<string, number> {
    return new Map(this.deliveryCounts);
  }
}
