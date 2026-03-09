import { Controller, Get, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { POSTGRES_SQL, type Sql } from '../../providers/postgres.provider';
import { REDIS_CLIENT } from '../../providers/redis.provider';

@Controller()
export class HealthController {
  constructor(
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get('health')
  async check() {
    const [pgOk, redisOk] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
    ]);

    const status = pgOk && redisOk ? 'ok' : 'degraded';

    return {
      status,
      postgres: pgOk ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
    };
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}
