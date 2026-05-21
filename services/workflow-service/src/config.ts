type WorkflowServiceConfig = {
  readonly port: number;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly natsUrl: string;
  readonly registryServiceUrl: string;
  readonly registryLookupTimeoutMs: number;
  readonly serviceSlugCacheTtlMs: number;
  readonly redisHost: string;
  readonly redisPort: number;
  readonly redisHostExplicit: boolean;

};

/**
 * Runtime config for the workflow-service.
 *
 * Postgres settings are intentionally absent: workflow data is stored
 * per-tenant via `WorkflowTenantConnectionManager`, which reads only
 * `POSTGRES_USER` / `POSTGRES_PASSWORD` from the environment to
 * authenticate against each tenant's own Postgres instance
 * (`postgres.{tenant}-{env}-ns.svc.cluster.local`). Platform-level
 * `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` are no longer
 * consumed.
 */
const DEFAULT_REGISTRY_URL =
  "http://registry-service.platform-services-dev.svc.cluster.local";

export const workflowServiceConfig: WorkflowServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
  registryServiceUrl: (
    process.env.REGISTRY_SERVICE_URL ?? DEFAULT_REGISTRY_URL
  ).replace(/\/+$/, ""),
  registryLookupTimeoutMs: Number.parseInt(
    process.env.REGISTRY_LOOKUP_TIMEOUT_MS ?? "5000",
    10,
  ),
  serviceSlugCacheTtlMs: Number.parseInt(
    process.env.SERVICE_SLUG_CACHE_TTL_MS ?? "3600000",
    10,
  ),
  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: Number.parseInt(process.env.REDIS_PORT ?? "6379", 10),
  redisHostExplicit: typeof process.env.REDIS_HOST === "string"
    && process.env.REDIS_HOST.length > 0,
};
