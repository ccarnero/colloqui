import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Consumer, JetStreamClient } from "nats";
import type Redis from "ioredis";
import {
  AdapterClient,
  DEFAULT_ADAPTER_SERVICE_URL,
  WEBHOOK_DLQ_SUBJECT,
  WEBHOOK_MAX_RETRIES,
  WEBHOOK_RETRY_DELAYS,
  TENANT_HEADER,
} from "@yoizen/shared";
import type { AdapterConfig, CompletionEvent } from "@yoizen/shared";
import {
  JETSTREAM_CONSUMER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import { REDIS_CLIENT } from "../../providers/redis.provider";
import { tracedFetch } from "@yoizen/observability";

@Injectable()
export class WebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookService.name);
  private readonly encoder = new TextEncoder();
  private readonly deliveryCounts = new Map<string, number>();
  private readonly adapterClient: AdapterClient;
  private consumeIterator: Awaited<
    ReturnType<Consumer["consume"]>
  > | null = null;

  constructor(
    @Inject(JETSTREAM_CONSUMER) private readonly consumer: Consumer,
    @Inject(JETSTREAM_PUBLISHER) private readonly publisher: JetStreamClient,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.adapterClient = new AdapterClient({
      baseUrl:
        process.env.ADAPTER_SERVICE_URL ?? DEFAULT_ADAPTER_SERVICE_URL,
      fetchFn: tracedFetch,
      cache: redis,
    });
  }

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

          const tenantId =
            (completion.result?.metadata?.tenantId as string | undefined) ??
            msg.headers?.get(TENANT_HEADER) ??
            undefined;

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

    let adapter: AdapterConfig | null = null;
    if (completion.adapterId && tenantId) {
      try {
        adapter = await this.adapterClient.getAdapter(
          tenantId,
          completion.adapterId,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to fetch adapter '${completion.adapterId}' for event ${eventId}, using defaults: ${err instanceof Error ? err.message : err}`,
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
        const response = await tracedFetch(callbackUrl!, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.ok) {
          this.trackDelivery(eventId, true);
          this.logger.log(
            `Webhook delivered for ${eventId} to ${callbackUrl} (attempt ${attempt + 1})`,
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
        await this.sleep(retryDelays[attempt]);
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
      this.injectAuthHeaders(adapter, headers);
    }

    if (tenantId) headers[TENANT_HEADER] = tenantId;
    return headers;
  }

  private injectAuthHeaders(
    adapter: AdapterConfig,
    headers: Record<string, string>,
  ): void {
    const { authType, authConfig } = adapter;

    switch (authType) {
      case "api-key": {
        const key = authConfig.apiKey as string;
        const headerName =
          (authConfig.apiKeyHeader as string) ?? "X-API-Key";
        headers[headerName] = key;
        break;
      }
      case "bearer": {
        headers["Authorization"] = `Bearer ${authConfig.bearerToken as string}`;
        break;
      }
      case "basic": {
        const encoded = btoa(
          `${authConfig.basicUsername as string}:${authConfig.basicPassword as string}`,
        );
        headers["Authorization"] = `Basic ${encoded}`;
        break;
      }
    }
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

  private trackDelivery(eventId: string, _success: boolean): void {
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
