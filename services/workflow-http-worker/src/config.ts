import { platformServiceUrl } from "@yoizen/shared";

const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

type WorkflowHttpWorkerConfig = {
  readonly port: number;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly redisHost: string;
  readonly redisPort: number;
  readonly httpResponseCacheEnabled: boolean;
  readonly adapterServiceUrl: string;
  readonly registryServiceUrl: string;
  readonly yoizenclawAdminServiceUrl: string;
};

export const workflowHttpWorkerConfig: WorkflowHttpWorkerConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: Number.parseInt(process.env.REDIS_PORT ?? "6379", 10),
  httpResponseCacheEnabled:
    process.env.HTTP_RESPONSE_CACHE_ENABLED?.toLowerCase() !== "false",
  adapterServiceUrl:
    process.env.ADAPTER_SERVICE_URL ??
    platformServiceUrl("adapter-service-api", env),
  registryServiceUrl:
    process.env.REGISTRY_SERVICE_URL ??
    platformServiceUrl("registry-service", env),
  yoizenclawAdminServiceUrl:
    process.env.YOIZENCLAW_ADMIN_SERVICE_URL ??
    platformServiceUrl("yoizenclaw-admin-service", env),
};
