type WorkflowServiceConfig = {
  readonly port: number;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly natsUrl: string;
};

export const workflowServiceConfig: WorkflowServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
};
