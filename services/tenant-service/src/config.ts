import { InternalServerErrorException } from "@nestjs/common";
import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";

const DEFAULT_POSTGRES_HOST = "postgres.support-services-dev.svc.cluster.local";
const DEFAULT_MONGO_HOST = "mongo-platform.support-services-dev.svc.cluster.local";
const DEFAULT_TENANT_POSTGRES_IMAGE = "pgvector/pgvector:pg17";
const DEFAULT_TENANT_USAGE_POSTGRES_IMAGE = "timescale/timescaledb-ha:pg17";
const DEFAULT_TENANT_USAGE_POSTGRES_STORAGE = "2Gi";
const DEFAULT_TENANT_MONGO_IMAGE = "mongo:7.0";
const DEFAULT_YOIZENCLAW_RUNTIME_IMAGE = "dev.local/yoizenclaw-runtime:local";

function requirePostgresPassword(): string {
  const pw = process.env.POSTGRES_PASSWORD ?? process.env.MONGO_PASSWORD;
  if (!pw) {
    throw new InternalServerErrorException(
      "POSTGRES_PASSWORD or MONGO_PASSWORD environment variable is required",
    );
  }
  return pw;
}

function requireMongoPassword(): string {
  const pw = process.env.MONGO_PASSWORD ?? process.env.POSTGRES_PASSWORD;
  if (!pw) {
    throw new InternalServerErrorException(
      "MONGO_PASSWORD or POSTGRES_PASSWORD environment variable is required",
    );
  }
  return pw;
}

type TenantServiceConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
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
  readonly tenantPostgresContainerImage: string;
  readonly tenantUsagePostgresContainerImage: string;
  readonly tenantUsagePostgresStorage: string;
  readonly mongoHost: string;
  readonly mongoPort: number;
  readonly mongoDb: string;
  readonly mongoUsageDb: string;
  readonly mongoUser: string;
  readonly mongoPassword: string;
  readonly mongoRootUser: string;
  readonly mongoRootPassword: string;
  readonly sharedMongoHost: string;
  readonly sharedMongoPort: number;
  readonly sharedMongoAdminUser: string;
  readonly sharedMongoAdminPassword: string;
  readonly sharedMongoTenantPassword: string;
  readonly tenantMongoContainerImage: string;
  readonly yoizenclawRuntimeAutoApply: boolean;
  readonly yoizenclawRuntimeImage: string;
  readonly yoizenclawRuntimeNatsUrl: string;
  readonly yoizenclawRuntimeConnectorAdminUrl: string;
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
  get dbEngine() {
    return resolveStorageEngine();
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
    return process.env.POSTGRES_DB ?? process.env.MONGO_DB ?? "yoizen";
  },
  get postgresUser() {
    return process.env.POSTGRES_USER ?? process.env.MONGO_USER ?? "yoizen";
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
  get mongoHost() {
    return process.env.MONGO_HOST ?? DEFAULT_MONGO_HOST;
  },
  get mongoPort() {
    return Number.parseInt(process.env.MONGO_PORT ?? "27017", 10);
  },
  get mongoDb() {
    return process.env.MONGO_DB ?? "yoizen";
  },
  get mongoUsageDb() {
    return process.env.MONGO_USAGE_DB ?? "yoizen_usage";
  },
  get mongoUser() {
    return process.env.MONGO_USER ?? "yoizen";
  },
  get mongoPassword() {
    return requireMongoPassword();
  },
  get mongoRootUser() {
    return process.env.MONGO_ROOT_USER ?? "root";
  },
  get mongoRootPassword() {
    return process.env.MONGO_ROOT_PASSWORD ?? requireMongoPassword();
  },
  get sharedMongoHost() {
    const env = platformEnvironment();
    return (
      process.env.TENANT_MONGO_SHARED_HOST ??
      `mongo-shared.support-services-${env}.svc.cluster.local`
    );
  },
  get sharedMongoPort() {
    return Number.parseInt(process.env.TENANT_MONGO_SHARED_PORT ?? "27017", 10);
  },
  get sharedMongoAdminUser() {
    return (
      process.env.TENANT_MONGO_SHARED_ADMIN_USER ??
      process.env.MONGO_ROOT_USER ??
      "root"
    );
  },
  get sharedMongoAdminPassword() {
    return (
      process.env.TENANT_MONGO_SHARED_ADMIN_PASSWORD ??
      process.env.MONGO_ROOT_PASSWORD ??
      requireMongoPassword()
    );
  },
  get sharedMongoTenantPassword() {
    return process.env.TENANT_MONGO_SHARED_PASSWORD ?? requireMongoPassword();
  },
  get tenantMongoContainerImage() {
    return process.env.TENANT_MONGO_IMAGE ?? DEFAULT_TENANT_MONGO_IMAGE;
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
