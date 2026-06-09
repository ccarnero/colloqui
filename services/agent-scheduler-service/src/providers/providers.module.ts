import { Global, Module } from "@nestjs/common";
import {
  TENANT_DB_CONNECTION_MANAGER,
} from "@yoizen/database";
import {
  lazyNatsProvider,
  NatsSchedulerPublisher,
  LAZY_NATS,
  jetStreamProvider,
  JETSTREAM,
} from "./nats.provider";
import { redisProvider, REDIS_CLIENT } from "./redis.provider";
import { SchedulerTenantConnectionManager } from "./tenant-connection.manager";

@Global()
@Module({
  providers: [
    lazyNatsProvider,
    jetStreamProvider,
    redisProvider,
    NatsSchedulerPublisher,
    SchedulerTenantConnectionManager,
    {
      provide: TENANT_DB_CONNECTION_MANAGER,
      useExisting: SchedulerTenantConnectionManager,
    },
  ],
  exports: [
    LAZY_NATS,
    JETSTREAM,
    REDIS_CLIENT,
    NatsSchedulerPublisher,
    SchedulerTenantConnectionManager,
    TENANT_DB_CONNECTION_MANAGER,
  ],
})
export class ProvidersModule {}
