import Redis from 'ioredis';
import type { FactoryProvider } from '@nestjs/common';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const redisProvider: FactoryProvider = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis => {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = parseInt(process.env.REDIS_PORT ?? '6379', 10);

    return new Redis({
      host,
      port,
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
  },
};
