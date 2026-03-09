import { Module } from '@nestjs/common';
import { CacheModule } from './modules/cache/cache.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './redis.module';

@Module({
  imports: [RedisModule, CacheModule, HealthModule],
})
export class AppModule {}
