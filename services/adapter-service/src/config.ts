const DEFAULT_POSTGRES_HOST = "postgres.support-services-dev.svc.cluster.local";

type AdapterServiceConfig = {
  readonly port: number;
  readonly defaultPostgresHost: string;
};

export const adapterServiceConfig: AdapterServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  defaultPostgresHost: process.env.POSTGRES_HOST ?? DEFAULT_POSTGRES_HOST,
};
