const DEFAULT_POSTGRES_HOST = "postgres.support-services-dev.svc.cluster.local";

type RegistryServiceConfig = {
  readonly port: number;
  readonly defaultPostgresHost: string;
  readonly platformEnvironment: string;
};

export const registryServiceConfig: RegistryServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  defaultPostgresHost: process.env.POSTGRES_HOST ?? DEFAULT_POSTGRES_HOST,
  platformEnvironment: process.env.PLATFORM_ENVIRONMENT ?? "dev",
};
