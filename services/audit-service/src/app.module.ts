import { Global, Module } from "@nestjs/common";
import { ObservabilityModule, resolveServiceName } from "@yoizen/observability";
import { AuditModule } from "./modules/audit/audit.module";
import { ChannelAuditModule } from "./modules/channel-audit/channel-audit.module";
import { ExecutionAuditModule } from "./modules/execution-audit/execution-audit.module";
import { GatewayAuditModule } from "./modules/gateway-audit/gateway-audit.module";
import { HealthModule } from "./modules/health/health.module";
import {
  GATEWAY_AUDIT_CONSUMER,
  gatewayAuditConsumerProvider,
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
  jetStreamManagerProvider,
  jetStreamPublisherProvider,
  NATS_CONNECTION,
  natsProvider,
} from "./providers/nats.provider";
import { ProvidersModule } from "./providers/providers.module";

/** Registers NATS and tenant DB access as global providers for audit feature modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: resolveServiceName("audit-service"),
    }),
    ProvidersModule,
    AuditModule,
    GatewayAuditModule,
    ChannelAuditModule,
    ExecutionAuditModule,
    HealthModule,
  ],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamPublisherProvider,
    gatewayAuditConsumerProvider,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_PUBLISHER,
    GATEWAY_AUDIT_CONSUMER,
  ],
})
export class AppModule {}
