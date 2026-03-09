import { Global, Module } from '@nestjs/common';
import { POSTGRES_SQL, postgresProvider } from './postgres.provider';
import { REDIS_CLIENT, redisProvider } from './redis.provider';

@Global()
@Module({
  providers: [postgresProvider, redisProvider],
  exports: [POSTGRES_SQL, REDIS_CLIENT],
})
export class ProvidersModule {}
