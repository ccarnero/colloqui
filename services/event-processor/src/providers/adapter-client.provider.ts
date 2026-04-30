import { type FactoryProvider } from "@nestjs/common";
import type Redis from "ioredis";
import { AdapterClient } from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";
import { eventProcessorConfig } from "../config";
import { REDIS_CLIENT } from "@yoizen/database";

export const ADAPTER_CLIENT = Symbol("ADAPTER_CLIENT");

export const adapterClientProvider: FactoryProvider<AdapterClient> = {
  provide: ADAPTER_CLIENT,
  inject: [REDIS_CLIENT],
  useFactory: (redis: Redis): AdapterClient =>
    new AdapterClient({
      baseUrl: eventProcessorConfig.adapterServiceUrl,
      fetchFn: tracedFetch,
      cache: redis,
    }),
};
