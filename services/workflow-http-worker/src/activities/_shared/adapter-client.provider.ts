import Redis from "ioredis";
import { tracedFetch } from "@yoizen/observability";
import { createAdapterClientWithRedisAndFetch } from "@yoizen/shared";
import { workflowHttpWorkerConfig } from "../../config";

type AdapterClientInstance = ReturnType<
  typeof createAdapterClientWithRedisAndFetch
>;

let adapterClient: AdapterClientInstance | null = null;

/**
 * Process-wide singleton `AdapterClient`. Centralized here so both
 * `endpoint-call` and `service-call` activities share one Redis pool
 * AND one SWR cache — prevents two clients racing on the same keys.
 */
export function getAdapterClient(): AdapterClientInstance {
  if (adapterClient) return adapterClient;

  const redis = new Redis({
    host: workflowHttpWorkerConfig.redisHost,
    port: workflowHttpWorkerConfig.redisPort,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

  adapterClient = createAdapterClientWithRedisAndFetch(
    workflowHttpWorkerConfig.adapterServiceUrl,
    redis,
    tracedFetch,
  );

  return adapterClient;
}
