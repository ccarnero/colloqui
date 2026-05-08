import { Global, Module } from "@nestjs/common";
import {
  natsProvider,
  jetStreamManagerProvider,
  jetStreamProvider,
} from "./nats.provider";
import { redisProvider } from "./redis.provider";

@Global()
@Module({
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    redisProvider,
  ],
  exports: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    redisProvider,
  ],
})
export class ProvidersModule {}
