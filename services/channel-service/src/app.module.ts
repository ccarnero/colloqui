import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { PostgresModule } from "./providers/postgres.provider";
import { ChannelTenantDbModule } from "./providers/channel-tenant-db.module";
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

/** Registers Postgres, NATS, and JetStream as global providers for channel modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "channel-service" }),
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
  ],
  exports: [NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_PUBLISHER],
})
export class AppModule {}
