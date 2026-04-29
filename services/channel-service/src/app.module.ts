import { Global, Module, type FactoryProvider } from "@nestjs/common";
import { ObservabilityModule, resolveServiceName } from "@yoizen/observability";
import {
  TenantConnectionManager,
  TenantDeletionEvictionListener,
} from "@yoizen/database";
import type { NatsConnection } from "nats";
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

/**
 * Channel-service caches TWO independent per-tenant Postgres pool sets:
 *   1. `ChannelTenantConnectionManager` — the channels DB
 *      (`postgres-channels` per namespace).
 *   2. `UsageTenantConnectionManager` (in `UsageModule`) — TimescaleDB
 *      writer (`postgres-usage`).
 *
 * Both pool caches go stale the moment a tenant is destroyed, so each
 * needs its own subscription to `platform.tenant.deleted`. We can't
 * map the base `TenantConnectionManager` token to a single concrete
 * provider here (Nest only allows one binding), so we instantiate two
 * `TenantDeletionEvictionListener` instances via factory providers —
 * each holds a reference to one manager and runs its own NATS
 * subscription. Two subscribers over Core NATS = both receive every
 * delivery; nothing is duplicated downstream because eviction is
 * idempotent on a fresh cache.
 */
const CHANNEL_TENANT_DELETION_LISTENER = "CHANNEL_TENANT_DELETION_LISTENER";
const USAGE_TENANT_DELETION_LISTENER = "USAGE_TENANT_DELETION_LISTENER";

const channelTenantDeletionListenerProvider: FactoryProvider<TenantDeletionEvictionListener> =
  {
    provide: CHANNEL_TENANT_DELETION_LISTENER,
    inject: [NATS_CONNECTION, ChannelTenantConnectionManager],
    useFactory: (
      nc: NatsConnection,
      tcm: TenantConnectionManager,
    ): TenantDeletionEvictionListener =>
      new TenantDeletionEvictionListener(nc, tcm),
  };

const usageTenantDeletionListenerProvider: FactoryProvider<TenantDeletionEvictionListener> =
  {
    provide: USAGE_TENANT_DELETION_LISTENER,
    inject: [NATS_CONNECTION, UsageTenantConnectionManager],
    useFactory: (
      nc: NatsConnection,
      tcm: TenantConnectionManager,
    ): TenantDeletionEvictionListener =>
      new TenantDeletionEvictionListener(nc, tcm),
  };

/** Registers Postgres, NATS, and JetStream as global providers for channel modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: resolveServiceName("channel-service"),
    }),
    PostgresModule,
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
