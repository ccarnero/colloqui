import { platformServiceUrl } from "@yoizen/shared";

const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

type WorkflowHttpWorkerConfig = {
  readonly port: number;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly redisHost: string;
  readonly redisPort: number;
  /**
   * When true, the breaker connects to Redis via the cluster client
   * (sharded topology, slot-aware routing). When false / unset, it
   * uses a standalone single-node connection. Wired via env so the
   * same image works against either deployment shape.
   */
  readonly redisClusterMode: boolean;
  readonly httpResponseCacheEnabled: boolean;
  readonly adapterServiceUrl: string;
  readonly registryServiceUrl: string;
  readonly agentAdminServiceUrl: string;
};

export const workflowHttpWorkerConfig: WorkflowHttpWorkerConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: Number.parseInt(process.env.REDIS_PORT ?? "6379", 10),
  redisClusterMode: process.env.REDIS_CLUSTER_MODE === "true",
  httpResponseCacheEnabled:
    process.env.HTTP_RESPONSE_CACHE_ENABLED?.toLowerCase() !== "false",
  adapterServiceUrl:
    process.env.CONNECTOR_ADMIN_URL ??
    platformServiceUrl("connector-admin-api", env),
  registryServiceUrl:
    process.env.REGISTRY_SERVICE_URL ??
    platformServiceUrl("registry-service", env),
  agentAdminServiceUrl:
    process.env.AGENT_ADMIN_SERVICE_URL ??
    platformServiceUrl("agent-admin-service", env),
};
