import { Controller, Get, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../providers/redis.provider';

@Controller()
export class HealthController {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get('health')
  async check(): Promise<{ status: string; redis: string }> {
    let redisOk = false;
    try {
      redisOk = (await this.redis.ping()) === 'PONG';
    } catch {
      redisOk = false;
    }
    return {
      status: redisOk ? 'ok' : 'degraded',
      redis: redisOk ? 'connected' : 'disconnected',
    };
  }
}
