import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Consumer, JetStreamClient } from "nats";
import type Redis from "ioredis";
import {
  applyAdapterAuthHeadersSync,
  createAdapterClientWithRedisAndFetch,
  evictOneOldestIfExceedsMax,
  sleep,
  WEBHOOK_DLQ_SUBJECT,
  WEBHOOK_MAX_RETRIES,
  WEBHOOK_RETRY_DELAYS,
  TENANT_HEADER,
} from "@yoizen/shared";
import type { AdapterConfig, CompletionEvent } from "@yoizen/shared";
import { NatsConsumerRunner } from "@yoizen/database";
import { webhookServiceConfig } from "../../config";
import {
  JETSTREAM_CONSUMER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import { REDIS_CLIENT } from "@yoizen/database";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";

@Injectable()
export class WebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(WebhookService.name);
  private readonly encoder = new TextEncoder();
  private readonly deliveryCounts = new Map<string, number>();
  private readonly adapterClient: ReturnType<
    typeof createAdapterClientWithRedisAndFetch
  >;
  private readonly runner: NatsConsumerRunner;

  constructor(
    @Inject(JETSTREAM_CONSUMER) consumer: Consumer,
    @Inject(JETSTREAM_PUBLISHER) private readonly publisher: JetStreamClient,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.adapterClient = createAdapterClientWithRedisAndFetch(
      webhookServiceConfig.adapterServiceUrl,
      redis,
      tracedFetch,
    );
    this.runner = new NatsConsumerRunner(
      consumer,
      (msg) => this.handleMessage(msg),
      this.logger,
      { maxMessages: 50 },
    );
  }

  async onModuleInit(): Promise<void> {
    await this.runner.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.runner.stop();
  }

  private async handleMessage(msg: import("nats").JsMsg): Promise<void> {
    const completion = msg.json() as CompletionEvent;
    const tenantId =
      (completion.result?.tenant as string | undefined) ??
      msg.headers?.get(TENANT_HEADER) ??
      undefined;

    await this.dispatchCompletionIfNeeded(completion, tenantId);
  }

  /**
   * Guard + dispatch (same as NATS handler after JSON parse).
   * @internal For unit tests covering the no-`callback_url` early return.
   */
  async dispatchCompletionIfNeeded(
    completion: CompletionEvent,
    tenantId?: string,
  ): Promise<void> {
    if (!completion.callback_url) return;
    await this.dispatchWithRetry(completion, tenantId);
  }

  private async dispatchWithRetry(
    completion: CompletionEvent,
    tenantId?: string,
  ): Promise<void> {
    const { eventId, callback_url, result } = completion;
    const body = JSON.stringify(result);

    let adapter: AdapterConfig | null = null;
    if (completion.adapter_id && tenantId) {
      try {
        adapter = await this.adapterClient.getAdapter(
          tenantId,
          completion.adapter_id,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to fetch adapter '${completion.adapter_id}' for event ${eventId}, using defaults: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const headers = this.buildHeaders(adapter, tenantId);
    const timeoutMs = adapter?.timeoutMs ?? 10_000;
    const maxRetries = adapter?.maxRetries ?? WEBHOOK_MAX_RETRIES;
    const retryDelays = adapter
      ? this.buildRetryDelays(adapter.retryBackoffMs, maxRetries)
      : WEBHOOK_RETRY_DELAYS;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await tracedFetch(callback_url!, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.ok) {
          this.trackDelivery(eventId);
          this.logger.log(
            `Webhook delivered for ${eventId} to ${callback_url} (attempt ${attempt + 1})`,
          );
          return;
        }

        this.logger.warn(
          `Webhook attempt ${attempt + 1}/${maxRetries} failed for ${eventId}: HTTP ${response.status}`,
        );
      } catch (err) {
        this.logger.warn(
          `Webhook attempt ${attempt + 1}/${maxRetries} failed for ${eventId}: ${err instanceof Error ? err.message : err}`,
        );
      }

      if (attempt < maxRetries - 1) {
        await sleep(retryDelays[attempt]);
      }
    }

    this.trackDelivery(eventId);
    this.logger.error(
      `Webhook delivery exhausted for ${eventId}, publishing to DLQ`,
    );

    await this.publisher.publish(
      WEBHOOK_DLQ_SUBJECT,
      this.encoder.encode(JSON.stringify(completion)),
    );
  }

  /**
   * Merges adapter auth + custom headers with base webhook headers.
   * Adapter headers (if present) are injected first, then tenant header.
   */
  private buildHeaders(
    adapter: AdapterConfig | null,
    tenantId?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (adapter) {
      for (const h of adapter.headers) {
        headers[h.key] = h.value;
      }
      applyAdapterAuthHeadersSync(adapter, headers);
    }

    if (tenantId) headers[TENANT_HEADER] = tenantId;
    return headers;
  }

  private buildRetryDelays(
    backoffMs: number,
    maxRetries: number,
  ): readonly number[] {
    const delays: number[] = [];
    for (let i = 0; i < maxRetries - 1; i++) {
      delays.push(backoffMs * (1 << i));
    }
    return delays;
  }

  private trackDelivery(eventId: string): void {
    const count = (this.deliveryCounts.get(eventId) ?? 0) + 1;
    this.deliveryCounts.set(eventId, count);

    evictOneOldestIfExceedsMax(this.deliveryCounts, 10_000);
  }
}
