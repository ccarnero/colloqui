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

type TenantServiceConfig = {
  readonly port: number;
  readonly platformEnvironment: string;
  readonly postgresHost: string;
  readonly postgresPort: number;
  readonly postgresDb: string;
  readonly postgresUser: string;
  readonly postgresPassword: string;
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
};
