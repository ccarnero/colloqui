import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type {
  JetStreamClient,
  Msg,
  NatsConnection,
  Subscription,
} from "nats";
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
import type {
  AdapterConfig,
  CompletionEvent,
  EventEnvelope,
} from "@yoizen/shared";
import { headers as natsHeaders } from "nats";
import { context as otelContext } from "@opentelemetry/api";
import { webhookServiceConfig } from "../../config";
import {
  JETSTREAM_PUBLISHER,
  NATS_CONNECTION,
} from "../../providers/nats.provider";

/**
 * Canonical subject pattern (wdocs 02 §9.3) for completion envelopes
 * emitted by the event-processor into per-tenant `INGRESS-<tenant>`
 * streams.
 */
const CANONICAL_COMPLETION_PATTERN =
  "evt.*.event-processor.platform.events.gateway.>";

import { REDIS_CLIENT } from "@yoizen/database";
import {
  PinoLoggerService,
  logWithEnvelope,
  startNatsConsumerSpan,
  tracedFetch,
} from "@yoizen/observability";

@Injectable()
export class WebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(WebhookService.name);
  private readonly encoder = new TextEncoder();
  private readonly deliveryCounts = new Map<string, number>();
  private readonly adapterClient: ReturnType<
    typeof createAdapterClientWithRedisAndFetch
  >;
  private subscription: Subscription | null = null;

  constructor(
    @Inject(JETSTREAM_PUBLISHER) private readonly publisher: JetStreamClient,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.adapterClient = createAdapterClientWithRedisAndFetch(
      webhookServiceConfig.adapterServiceUrl,
      redis,
      tracedFetch,
    );
  }

  async onModuleInit(): Promise<void> {
    this.subscription = this.nc.subscribe(CANONICAL_COMPLETION_PATTERN, {
      callback: (_err, msg) => {
        this.handleMessage(msg).catch((err) => {
          this.logger.warn(
            `webhook handler error: ${err instanceof Error ? err.message : err}`,
          );
        });
      },
    });
    this.logger.log(
      `Webhook subscribed to: ${CANONICAL_COMPLETION_PATTERN}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  private async handleMessage(msg: Msg): Promise<void> {
    const body = JSON.parse(new TextDecoder().decode(msg.data)) as
      | EventEnvelope
      | CompletionEvent;
    await this.dispatch(body, msg.subject, msg.headers);
  }

  private async dispatch(
    body: EventEnvelope | CompletionEvent,
    subject: string,
    headers: Msg["headers"],
  ): Promise<void> {
    const { envelope, completion } = unwrapCompletion(body);

    const tenantId =
      envelope?.tenant ??
      (completion.result?.tenant as string | undefined) ??
      headers?.get(TENANT_HEADER) ??
      undefined;

    // Resume distributed trace (wdocs 06 §6).
    const incomingHeaders = headers ?? natsHeaders();
    const { span, context: spanCtx } = startNatsConsumerSpan(
      "webhook-service",
      subject,
      incomingHeaders,
    );

    try {
      await otelContext.with(spanCtx, () =>
        this.dispatchCompletionIfNeeded(completion, tenantId, envelope),
      );
    } finally {
      span.end();
    }
  }

  /**
   * Guard + dispatch (same as NATS handler after JSON parse).
   * @internal For unit tests covering the no-`callback_url` early return.
   */
  async dispatchCompletionIfNeeded(
    completion: CompletionEvent,
    tenantId?: string,
    envelope?: EventEnvelope,
  ): Promise<void> {
    if (!completion.callback_url) return;
    await this.dispatchWithRetry(completion, tenantId, envelope);
  }

  private async dispatchWithRetry(
    completion: CompletionEvent,
    tenantId?: string,
    envelope?: EventEnvelope,
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

    const headers = this.buildHeaders(adapter, tenantId, envelope);
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
          logWithEnvelope(
            this.logger,
            envelope,
            "webhook.delivered",
            `Webhook delivered for ${eventId} to ${callback_url} (attempt ${attempt + 1})`,
          );
          return;
        }

        logWithEnvelope(
          this.logger,
          envelope,
          "webhook.attempt_failed",
          `Webhook attempt ${attempt + 1}/${maxRetries} failed for ${eventId}: HTTP ${response.status}`,
          "warn",
        );
      } catch (err) {
        logWithEnvelope(
          this.logger,
          envelope,
          "webhook.attempt_failed",
          `Webhook attempt ${attempt + 1}/${maxRetries} failed for ${eventId}: ${err instanceof Error ? err.message : err}`,
          "warn",
        );
      }

      if (attempt < maxRetries - 1) {
        await sleep(retryDelays[attempt]);
      }
    }

    this.trackDelivery(eventId);
    logWithEnvelope(
      this.logger,
      envelope,
      "webhook.exhausted",
      `Webhook delivery exhausted for ${eventId}, publishing to DLQ`,
      "error",
    );

    await this.publisher.publish(
      WEBHOOK_DLQ_SUBJECT,
      this.encoder.encode(JSON.stringify(completion)),
    );
  }

  /**
   * Merges adapter auth + custom headers with base webhook headers.
   * Adapter headers (if present) are injected first, then tenant header.
   * When an envelope is available, propagates correlation/causation ids
   * so downstream services can re-link the causal chain (wdocs 02 §6).
   */
  private buildHeaders(
    adapter: AdapterConfig | null,
    tenantId?: string,
    envelope?: EventEnvelope,
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
    if (envelope?.correlation_id) {
      headers["X-Correlation-Id"] = envelope.correlation_id;
    }
    if (envelope?.causation_id) {
      headers["X-Causation-Id"] = envelope.causation_id;
    }
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

/**
 * Accepts either the legacy `CompletionEvent` body (raw object) or the
 * new wdocs-compliant `EventEnvelope` that wraps it in `data.payload`
 * (see event-processor). Returns both the envelope (when available) and
 * the unwrapped completion so the dispatcher can read either shape.
 */
export function unwrapCompletion(
  body: EventEnvelope | CompletionEvent,
): { envelope?: EventEnvelope; completion: CompletionEvent } {
  if (
    typeof body === "object" &&
    body !== null &&
    (body as EventEnvelope).specversion === "1.0" &&
    typeof (body as EventEnvelope).data === "object" &&
    (body as EventEnvelope).data !== null
  ) {
    const envelope = body as EventEnvelope;
    const payload = envelope.data.payload ?? {};
    if (
      typeof payload === "object" &&
      payload !== null &&
      "eventId" in (payload as Record<string, unknown>)
    ) {
      return { envelope, completion: payload as unknown as CompletionEvent };
    }
  }
  return { completion: body as CompletionEvent };
}
