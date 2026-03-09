import { Global, Module } from '@nestjs/common';
import { redisProvider } from './providers/redis.provider';

@Global()
@Module({
  providers: [redisProvider],
  exports: [redisProvider],
})
export class RedisModule {}
