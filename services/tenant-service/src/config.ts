import { InternalServerErrorException } from "@nestjs/common";

const DEFAULT_POSTGRES_HOST = "postgres.support-services-dev.svc.cluster.local";

function requirePostgresPassword(): string {
  const pw = process.env.POSTGRES_PASSWORD;
  if (!pw) {
    throw new InternalServerErrorException(
      "POSTGRES_PASSWORD environment variable is required",
    );
  }
  return pw;
}

/** Default matches platform `infrastructure/base/postgres` (pgvector-enabled). */
const DEFAULT_TENANT_POSTGRES_IMAGE = "pgvector/pgvector:pg17";
/** Dedicated per-tenant TimescaleDB instance for usage metrics. */
const DEFAULT_TENANT_USAGE_POSTGRES_IMAGE = "timescale/timescaledb-ha:pg17";
const DEFAULT_TENANT_USAGE_POSTGRES_STORAGE = "2Gi";

/** Default container image for the per-tenant YoizenClaw runtime Knative Service. */
const DEFAULT_YOIZENCLAW_RUNTIME_IMAGE = "dev.local/yoizenclaw-runtime:local";

type TenantServiceConfig = {
  readonly port: number;
  readonly platformEnvironment: string;
  readonly postgresHost: string;
  readonly postgresPort: number;
  readonly postgresDb: string;
  readonly postgresUser: string;
  readonly postgresPassword: string;
  readonly sharedPostgresHost: string;
  readonly sharedPostgresPort: number;
  readonly sharedPostgresAdminDb: string;
  readonly sharedPostgresAdminUser: string;
  readonly sharedPostgresAdminPassword: string;
  readonly sharedPostgresTenantPassword: string;
  /** Container image for per-tenant PostgreSQL StatefulSet (main + init-permissions). */
  readonly tenantPostgresContainerImage: string;
  /** Container image for per-tenant dedicated TimescaleDB (usage metrics) StatefulSet. */
  readonly tenantUsagePostgresContainerImage: string;
  /** PVC storage size for the per-tenant TimescaleDB (usage) instance. */
  readonly tenantUsagePostgresStorage: string;
  /**
   * When `true` (default), `TenantProvisioningExecutor` applies the
   * yoizenclaw-runtime Knative Service into the tenant namespace after
   * Postgres readiness. Set `YOIZENCLAW_RUNTIME_AUTO_APPLY=false` to opt
   * out (e.g. when an external GitOps controller owns it).
   */
  readonly yoizenclawRuntimeAutoApply: boolean;
  /** Container image for per-tenant yoizenclaw-runtime Knative Service. */
  readonly yoizenclawRuntimeImage: string;
  /** NATS URL injected into the per-tenant yoizenclaw-runtime container. */
  readonly yoizenclawRuntimeNatsUrl: string;
  /** connector-admin REST URL injected into the per-tenant yoizenclaw-runtime container. */
  readonly yoizenclawRuntimeConnectorAdminUrl: string;
  /** OTEL OTLP/HTTP endpoint injected into the per-tenant yoizenclaw-runtime container. */
  readonly yoizenclawRuntimeOtelEndpoint: string;
};

function platformEnvironment(): string {
  return process.env.PLATFORM_ENVIRONMENT ?? "dev";
}

/** Lazy getters so tests can set `process.env` before first read. */
export const tenantServiceConfig: TenantServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get platformEnvironment() {
    return platformEnvironment();
  },
  get postgresHost() {
    return process.env.POSTGRES_HOST ?? DEFAULT_POSTGRES_HOST;
  },
  get postgresPort() {
    return Number.parseInt(process.env.POSTGRES_PORT ?? "5432", 10);
  },
  get postgresDb() {
    return process.env.POSTGRES_DB ?? "yoizen";
  },
  get postgresUser() {
    return process.env.POSTGRES_USER ?? "yoizen";
  },
  get postgresPassword() {
    return requirePostgresPassword();
  },
  get sharedPostgresHost() {
    const env = platformEnvironment();
    return (
      process.env.TENANT_POSTGRES_SHARED_HOST ??
      `postgres-shared.support-services-${env}.svc.cluster.local`
    );
  },
  get sharedPostgresPort() {
    return Number.parseInt(process.env.TENANT_POSTGRES_SHARED_PORT ?? "5432", 10);
  },
  get sharedPostgresAdminDb() {
    return process.env.TENANT_POSTGRES_SHARED_ADMIN_DB ?? "postgres";
  },
  get sharedPostgresAdminUser() {
    return (
      process.env.TENANT_POSTGRES_SHARED_ADMIN_USER ??
      process.env.POSTGRES_USER ??
      "yoizen"
    );
  },
  get sharedPostgresAdminPassword() {
    return (
      process.env.TENANT_POSTGRES_SHARED_ADMIN_PASSWORD ??
      requirePostgresPassword()
    );
  },
  get sharedPostgresTenantPassword() {
    return (
      process.env.TENANT_POSTGRES_SHARED_PASSWORD ?? requirePostgresPassword()
    );
  },
  get tenantPostgresContainerImage() {
    return process.env.TENANT_POSTGRES_IMAGE ?? DEFAULT_TENANT_POSTGRES_IMAGE;
  },
  get tenantUsagePostgresContainerImage() {
    return (
      process.env.TENANT_USAGE_POSTGRES_IMAGE ??
      DEFAULT_TENANT_USAGE_POSTGRES_IMAGE
    );
  },
  get tenantUsagePostgresStorage() {
    return (
      process.env.TENANT_USAGE_POSTGRES_STORAGE ??
      DEFAULT_TENANT_USAGE_POSTGRES_STORAGE
    );
  },
  get yoizenclawRuntimeAutoApply() {
    const raw = process.env.YOIZENCLAW_RUNTIME_AUTO_APPLY;
    if (raw === undefined) return true;
    return raw.toLowerCase() !== "false" && raw !== "0";
  },
  get yoizenclawRuntimeImage() {
    return (
      process.env.YOIZENCLAW_RUNTIME_IMAGE ?? DEFAULT_YOIZENCLAW_RUNTIME_IMAGE
    );
  },
  get yoizenclawRuntimeNatsUrl() {
    const env = platformEnvironment();
    return (
      process.env.YOIZENCLAW_RUNTIME_NATS_URL ??
      `nats://nats.support-services-${env}.svc.cluster.local:4222`
    );
  },
  get yoizenclawRuntimeConnectorAdminUrl() {
    const env = platformEnvironment();
    return (
      process.env.YOIZENCLAW_RUNTIME_CONNECTOR_ADMIN_URL ??
      `http://connector-admin-api.platform-services-${env}.svc.cluster.local`
    );
  },
  get yoizenclawRuntimeOtelEndpoint() {
    const env = platformEnvironment();
    return (
      process.env.YOIZENCLAW_RUNTIME_OTEL_ENDPOINT ??
      `http://otel-collector.support-services-${env}.svc.cluster.local:4318`
    );
  },
};
