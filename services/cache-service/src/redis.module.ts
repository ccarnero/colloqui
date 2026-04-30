import { Global, Module } from "@nestjs/common";
import { REDIS_CLIENT, redisProvider } from "@yoizen/database";

@Global()
@Module({
  providers: [redisProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
