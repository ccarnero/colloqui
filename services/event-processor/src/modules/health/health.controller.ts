import { Controller, Get, Inject } from '@nestjs/common';
import type { NatsConnection } from 'nats';
import type Redis from 'ioredis';
import { NATS_CONNECTION } from '../../providers/nats.provider';
import { REDIS_CLIENT } from '../../providers/redis.provider';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nats: NatsConnection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<{ status: string; nats: boolean; redis: boolean }> {
    let natsOk = false;
    let redisOk = false;
    try {
      natsOk = !this.nats.isClosed();
    } catch {
      natsOk = false;
    }
    try {
      await this.redis.ping();
      redisOk = true;
    } catch {
      redisOk = false;
    }
    const status = natsOk && redisOk ? 'ok' : 'degraded';
    return { status, nats: natsOk, redis: redisOk };
  }
}
