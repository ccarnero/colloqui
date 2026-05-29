import { Global, Module, type FactoryProvider } from "@nestjs/common";
import { ObservabilityModule, resolveServiceName } from "@yoizen/observability";
import {
  TenantConnectionManager,
  TenantDeletionEvictionListener,
  TenantMongoConnectionManager,
  TenantMongoDeletionEvictionListener,
} from "@yoizen/database";
import type { NatsConnection } from "nats";
import { channelServiceConfig } from "./config";
import { MongoModule } from "./providers/mongo.provider";
import { PostgresModule } from "./providers/postgres.provider";
import { ChannelTenantDbModule } from "./providers/channel-tenant-db.module";
import { ChannelTenantConnectionManager } from "./providers/channel-tenant-connection-manager";
import { UsageTenantConnectionManager } from "./modules/usage/tenant-connection-manager";
import {
  natsProvider,
  jetStreamManagerProvider,
  jetStreamPublisherProvider,
  NATS_CONNECTION,
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "./providers/nats.provider";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";
import { IngressModule } from "./modules/ingress/ingress.module";
import { EgressModule } from "./modules/egress/egress.module";
import { AccountsModule } from "./modules/accounts/accounts.module";
import { AutoReplyModule } from "./modules/auto-reply/auto-reply.module";
import { HealthModule } from "./modules/health/health.module";
import { UsageModule } from "./modules/usage/usage.module";
import { StreamsModule } from "./modules/streams/streams.module";

const engine = channelServiceConfig.dbEngine;

/**
 * Channel-service caches TWO independent per-tenant connection sets:
 *   1. `ChannelTenantConnectionManager` — channel OLTP data.
 *   2. `UsageTenantConnectionManager` — usage time-series reads.
 *
 * Both caches go stale when a tenant is destroyed, so each needs its
 * own deletion eviction listener subscription.
 */
const CHANNEL_TENANT_DELETION_LISTENER = "CHANNEL_TENANT_DELETION_LISTENER";
const USAGE_TENANT_DELETION_LISTENER = "USAGE_TENANT_DELETION_LISTENER";

const channelTenantDeletionListenerProvider: FactoryProvider =
  engine === "postgres"
    ? {
        provide: CHANNEL_TENANT_DELETION_LISTENER,
        inject: [NATS_CONNECTION, ChannelTenantConnectionManager],
        useFactory: (
          nc: NatsConnection,
          tcm: TenantConnectionManager,
        ): TenantDeletionEvictionListener =>
          new TenantDeletionEvictionListener(nc, tcm),
      }
    : {
        provide: CHANNEL_TENANT_DELETION_LISTENER,
        inject: [NATS_CONNECTION, ChannelTenantConnectionManager],
        useFactory: (
          nc: NatsConnection,
          tcm: TenantMongoConnectionManager,
        ): TenantMongoDeletionEvictionListener =>
          new TenantMongoDeletionEvictionListener(nc, tcm),
      };

const usageTenantDeletionListenerProvider: FactoryProvider =
  engine === "postgres"
    ? {
        provide: USAGE_TENANT_DELETION_LISTENER,
        inject: [NATS_CONNECTION, UsageTenantConnectionManager],
        useFactory: (
          nc: NatsConnection,
          tcm: TenantConnectionManager,
        ): TenantDeletionEvictionListener =>
          new TenantDeletionEvictionListener(nc, tcm),
      }
    : {
        provide: USAGE_TENANT_DELETION_LISTENER,
        inject: [NATS_CONNECTION, UsageTenantConnectionManager],
        useFactory: (
          nc: NatsConnection,
          tcm: TenantMongoConnectionManager,
        ): TenantMongoDeletionEvictionListener =>
          new TenantMongoDeletionEvictionListener(nc, tcm),
      };

/** Registers storage, NATS, and JetStream as global providers for channel modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: resolveServiceName("channel-service"),
    }),
    ...(engine === "postgres" ? [PostgresModule] : [MongoModule]),
    ChannelTenantDbModule,
    WebhooksModule,
    IngressModule,
    EgressModule,
    AccountsModule,
    AutoReplyModule,
    UsageModule,
    StreamsModule,
    HealthModule,
  ],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamPublisherProvider,
    channelTenantDeletionListenerProvider,
    usageTenantDeletionListenerProvider,
  ],
  exports: [NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_PUBLISHER],
})
export class AppModule {}
