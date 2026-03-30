import Redis from "ioredis";
import type { FactoryProvider } from "@nestjs/common";

export const REDIS_CLIENT = "REDIS_CLIENT";

const host = process.env.REDIS_HOST ?? "localhost";
const port = Number(process.env.REDIS_PORT ?? 6379);

export const redisProvider: FactoryProvider = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis =>
    new Redis({
      host,
      port,
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    }),
};
