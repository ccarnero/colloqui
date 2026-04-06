import { DEFAULT_ADAPTER_SERVICE_URL } from "@yoizen/shared";

type WorkflowHttpWorkerConfig = {
  readonly port: number;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly redisHost: string;
  readonly redisPort: number;
  readonly adapterServiceUrl: string;
};

export const workflowHttpWorkerConfig: WorkflowHttpWorkerConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: Number.parseInt(process.env.REDIS_PORT ?? "6379", 10),
  adapterServiceUrl:
    process.env.ADAPTER_SERVICE_URL ?? DEFAULT_ADAPTER_SERVICE_URL,
};
