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

type TenantServiceConfig = {
  readonly port: number;
  readonly platformEnvironment: string;
  readonly postgresHost: string;
  readonly postgresPort: number;
  readonly postgresDb: string;
  readonly postgresUser: string;
  readonly postgresPassword: string;
  /** Container image for per-tenant PostgreSQL StatefulSet (main + init-permissions). */
  readonly tenantPostgresContainerImage: string;
  /** Container image for per-tenant dedicated TimescaleDB (usage metrics) StatefulSet. */
  readonly tenantUsagePostgresContainerImage: string;
  /** PVC storage size for the per-tenant TimescaleDB (usage) instance. */
  readonly tenantUsagePostgresStorage: string;
};

/** Lazy getters so tests can set `process.env` before first read. */
export const tenantServiceConfig: TenantServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get platformEnvironment() {
    return process.env.PLATFORM_ENVIRONMENT ?? "dev";
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
};
