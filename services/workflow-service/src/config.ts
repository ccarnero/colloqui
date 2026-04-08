type WorkflowServiceConfig = {
  readonly port: number;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly natsUrl: string;
  readonly postgresHost: string;
  readonly postgresPort: number;
  readonly postgresDb: string;
  readonly postgresUser: string;
  readonly postgresPassword: string;
};

export const workflowServiceConfig: WorkflowServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
  postgresHost: process.env.POSTGRES_HOST ?? "localhost",
  postgresPort: Number.parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
  postgresDb: process.env.POSTGRES_DB ?? "yoizen",
  postgresUser: process.env.POSTGRES_USER ?? "yoizen",
  postgresPassword: process.env.POSTGRES_PASSWORD ?? "",
};
