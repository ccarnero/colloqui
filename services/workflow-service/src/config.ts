import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";

type WorkflowServiceConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
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
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get dbEngine() {
    return resolveStorageEngine();
  },
  get temporalAddress() {
    return process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  },
  get temporalNamespace() {
    return process.env.TEMPORAL_NAMESPACE ?? "default";
  },
  get natsUrl() {
    return process.env.NATS_URL ?? "nats://localhost:4222";
  },
  get registryServiceUrl() {
    return (
      process.env.REGISTRY_SERVICE_URL ?? DEFAULT_REGISTRY_URL
    ).replace(/\/+$/, "");
  },
  get registryLookupTimeoutMs() {
    return Number.parseInt(
      process.env.REGISTRY_LOOKUP_TIMEOUT_MS ?? "5000",
      10,
    );
  },
  get serviceSlugCacheTtlMs() {
    return Number.parseInt(
      process.env.SERVICE_SLUG_CACHE_TTL_MS ?? "3600000",
      10,
    );
  },
  get redisHost() {
    return process.env.REDIS_HOST ?? "localhost";
  },
  get redisPort() {
    return Number.parseInt(process.env.REDIS_PORT ?? "6379", 10);
  },
  get redisHostExplicit() {
    return (
      typeof process.env.REDIS_HOST === "string" &&
      process.env.REDIS_HOST.length > 0
    );
  },
};
