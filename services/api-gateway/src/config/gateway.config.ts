const K8S_DOMAIN = "svc.cluster.local";

const gatewayPort = Number.parseInt(process.env.PORT ?? "3000", 10);

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
  environment: process.env.PLATFORM_ENVIRONMENT ?? "dev",
  /** Read at access time so tests can set JWT_SECRET before first use. */
  get jwtSecret(): string {
    return process.env.JWT_SECRET ?? "";
  },

  services: {
    auth:
      process.env.AUTH_SERVICE_URL ??
      `http://auth-service.platform-services.${K8S_DOMAIN}`,
    audit:
      process.env.AUDIT_SERVICE_URL ??
      `http://audit-service.platform-services-dev.${K8S_DOMAIN}`,
    tenant:
      process.env.TENANT_SERVICE_URL ??
      `http://tenant-service.platform-services-dev.${K8S_DOMAIN}`,
    scheduler:
      process.env.SCHEDULER_SERVICE_URL ??
      `http://scheduler-service.platform-services.${K8S_DOMAIN}`,
    registry:
      process.env.REGISTRY_SERVICE_URL ??
      `http://registry-service.platform-services.${K8S_DOMAIN}`,
    workflow:
      process.env.WORKFLOW_SERVICE_URL ??
      `http://workflow-api.platform-services.${K8S_DOMAIN}`,
    adapter:
      process.env.ADAPTER_SERVICE_URL ??
      `http://adapter-service.platform-services-dev.${K8S_DOMAIN}`,
    cache:
      process.env.CACHE_SERVICE_URL ??
      `http://cache-service.platform-services-dev.${K8S_DOMAIN}`,
    webhook:
      process.env.WEBHOOK_SERVICE_URL ??
      `http://webhook-service.platform-services-dev.${K8S_DOMAIN}`,
    eventProcessor:
      process.env.EVENT_PROCESSOR_URL ??
      `http://event-processor.platform-services-dev.${K8S_DOMAIN}`,
    metrics:
      process.env.METRICS_SERVICE_URL ??
      `http://metrics-service.platform-services-dev.${K8S_DOMAIN}`,
    proxy:
      process.env.PROXY_SERVICE_URL ??
      `http://proxy-service.platform-services-dev.${K8S_DOMAIN}`,
    channel:
      process.env.CHANNEL_SERVICE_URL ??
      `http://channel-service.platform-services-dev.${K8S_DOMAIN}`,
    admin:
      process.env.ADMIN_SERVICE_URL ??
      `http://yoizenclaw-admin-service.platform-services-dev.${K8S_DOMAIN}`,
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
} as const;
