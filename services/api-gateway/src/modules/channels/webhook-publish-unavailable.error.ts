import { ServiceUnavailableException } from "@nestjs/common";

/**
 * Marker key embedded in the response body so the global
 * `ServiceExceptionFilter` can recognise this exception class without
 * a hard `instanceof` import dependency on the filter side.
 */
export const WEBHOOK_PUBLISH_UNAVAILABLE_MARKER =
  "webhook_publish_unavailable" as const;

/**
 * Thrown when `WebhookIngressPublisherService.publishWebhook` cannot
 * obtain a JetStream publish ack within `gatewayConfig.webhook.
 * publishTimeoutMs`, or when the per-pod in-flight cap is exhausted.
 *
 * Mapped to HTTP 503 (NestJS default) with a `Retry-After` header in
 * `ServiceExceptionFilter` so providers (Telegram, generic HTTP callers)
 * trigger their own retry path instead of dropping the webhook —
 * see `post-mortem/POST-MORTEM.md` §P1.2.
 */
export class WebhookPublishUnavailableError extends ServiceUnavailableException {
  /** Seconds the caller should wait before retrying. */
  public readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = 5) {
    super({
      statusCode: 503,
      message,
      error: "Service Unavailable",
      marker: WEBHOOK_PUBLISH_UNAVAILABLE_MARKER,
      retryAfterSeconds,
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
