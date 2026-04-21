import Redis from "ioredis";
import { tracedFetch } from "@yoizen/observability";
import { createAdapterClientWithRedisAndFetch } from "@yoizen/shared";
import { workflowHttpWorkerConfig } from "../../config";
import {
  createHttpResponseCache,
  type IHttpResponseCache,
} from "./http-cache/http-response-cache";

type AdapterClientInstance = ReturnType<
  typeof createAdapterClientWithRedisAndFetch
>;

let adapterClient: AdapterClientInstance | null = null;
let httpResponseCache: IHttpResponseCache | null = null;
let redis: Redis | null = null;

function getRedis(): Redis {
  if (redis) {
    return redis;
  }

  redis = new Redis({
    host: workflowHttpWorkerConfig.redisHost,
    port: workflowHttpWorkerConfig.redisPort,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
  return redis;
}

/**
 * Process-wide singleton `AdapterClient`. Centralized here so both
 * `endpoint-call` and `service-call` activities share one Redis pool
 * AND one SWR cache — prevents two clients racing on the same keys.
 */
export function getAdapterClient(): AdapterClientInstance {
  if (adapterClient) return adapterClient;

  adapterClient = createAdapterClientWithRedisAndFetch(
    workflowHttpWorkerConfig.adapterServiceUrl,
    getRedis(),
    tracedFetch,
  );

  return adapterClient;
}

export function getHttpResponseCache(): IHttpResponseCache {
  if (httpResponseCache) {
    return httpResponseCache;
  }

  httpResponseCache = createHttpResponseCache(getRedis());
  return httpResponseCache;
}
