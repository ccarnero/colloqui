import { platformServiceUrl } from "@yoizen/shared";

const gatewayPort = Number.parseInt(process.env.PORT ?? "3000", 10);
const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

/**
 * Parses a positive integer env var with a deterministic fallback.
 * Mirrors the inline pattern used throughout this file but centralises
 * NaN / negative handling so the post-mortem-driven webhook knobs
 * below cannot be misconfigured into a no-op.
 */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Centralized gateway configuration derived from environment variables.
 * Eliminates scattered process.env reads across proxy services.
 */
export const gatewayConfig = {
  port: gatewayPort,
  /** Base URL for this gateway (e.g. dashboard aggregator fetching own /health). */
  selfBaseUrl:
    process.env.API_GATEWAY_SELF_URL ?? `http://127.0.0.1:${gatewayPort}`,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:4200",
  environment: env,
  /** Read at access time so tests can set JWT_SECRET before first use. */
  get jwtSecret(): string {
    return process.env.JWT_SECRET ?? "";
  },

  services: {
    auth:
      process.env.AUTH_SERVICE_URL ??
      platformServiceUrl("auth-service", env),
    // Phase 1.5: every service that was split into api ↔ worker now
    // resolves to the `*-api` Knative Service. Worker pods don't expose
    // an HTTP route. Override via the corresponding *_SERVICE_URL env var
    // (set by the overlay env-patches.yaml).
    audit:
      process.env.AUDIT_SERVICE_URL ??
      platformServiceUrl("audit-service-api", env),
    tenant:
      process.env.TENANT_SERVICE_URL ??
      platformServiceUrl("tenant-service", env),
    registry:
      process.env.REGISTRY_SERVICE_URL ??
      platformServiceUrl("registry-service", env),
    workflow:
      process.env.WORKFLOW_SERVICE_URL ??
      platformServiceUrl("workflow-service-api", env),
    connectorAdmin:
      process.env.CONNECTOR_ADMIN_URL ??
      platformServiceUrl("connector-admin-api", env),
    cache:
      process.env.CACHE_SERVICE_URL ??
      platformServiceUrl("cache-service", env),
    proxy:
      process.env.PROXY_SERVICE_URL ??
      platformServiceUrl("proxy-service", env),
    channel:
      process.env.CHANNEL_SERVICE_URL ??
      platformServiceUrl("channel-service-api", env),
    admin:
      process.env.ADMIN_SERVICE_URL ??
      platformServiceUrl("yoizenclaw-admin-service", env),
    runtimeGateway:
      process.env.YOIZENCLAW_RUNTIME_GATEWAY_URL ??
      platformServiceUrl("yoizenclaw-runtime-gateway", env),
  },

  rateLimit: {
    algorithm:
      (process.env.RATE_LIMIT_ALGORITHM as
        | "token-bucket"
        | "sliding-window"
        | "fixed-window") ?? "token-bucket",
    defaultLimit: Number(process.env.RATE_LIMIT_DEFAULT_LIMIT ?? 100),
    defaultWindowMs: Number(process.env.RATE_LIMIT_DEFAULT_WINDOW_MS ?? 60000),
    defaultCapacity: Number(process.env.RATE_LIMIT_DEFAULT_CAPACITY ?? 100),
    defaultRefillRate: Number(process.env.RATE_LIMIT_DEFAULT_REFILL_RATE ?? 10),
  },

  /**
   * Webhook publish safety nets — introduced by the 2026-05-22 stress
   * post-mortem (`post-mortem/POST-MORTEM.md` §P1.2). The default JS
   * NATS client request timeout (~5s) was firing in clusters during
   * JetStream stalls and surfacing as opaque 500s to providers
   * (118 `NatsError: TIMEOUT` in 2 seconds at peak).
   *
   * `publishTimeoutMs` bounds the `js.publish` ack; on expiry the
   * publisher throws a `ServiceUnavailableException` so the global
   * exception filter returns HTTP 503 + `Retry-After`, prompting
   * providers (WhatsApp / Telegram / Meta) to retry instead of dropping
   * the webhook.
   *
   * `publishInflightCap` caps concurrent in-flight publishes per pod
   * so a backend stall cannot let pending acks grow unbounded.
   */
  webhook: {
    publishTimeoutMs: positiveIntEnv("WEBHOOK_PUBLISH_TIMEOUT_MS", 10_000),
    publishInflightCap: positiveIntEnv("WEBHOOK_PUBLISH_INFLIGHT_CAP", 200),
  },
} as const;
