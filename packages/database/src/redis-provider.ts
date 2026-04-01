import Redis from "ioredis";
import type { FactoryProvider } from "@nestjs/common";

export const REDIS_CLIENT = "REDIS_CLIENT";

export interface RedisProviderOptions {
  /** Default host when REDIS_HOST is not set (default: "localhost") */
  defaultHost?: string;
  /** Default port when REDIS_PORT is not set (default: 6379) */
  defaultPort?: number;
  /** Max retries per request (default: 3) */
  maxRetriesPerRequest?: number;
}

/**
 * Creates a NestJS `FactoryProvider` for an ioredis client.
 * Reads `REDIS_HOST` and `REDIS_PORT` from environment variables.
 */
export function createRedisProvider(
  options: RedisProviderOptions = {},
): FactoryProvider<Redis> {
  const {
    defaultHost = "localhost",
    defaultPort = 6379,
    maxRetriesPerRequest = 3,
  } = options;

  return {
    provide: REDIS_CLIENT,
    useFactory: (): Redis => {
      const host = process.env.REDIS_HOST ?? defaultHost;
      const port = Number(process.env.REDIS_PORT) || defaultPort;

      return new Redis({
        host,
        port,
        enableReadyCheck: true,
        lazyConnect: true,
        maxRetriesPerRequest,
      });
    },
  };
}
